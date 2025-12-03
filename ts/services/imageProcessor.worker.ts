/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import { parentPort, workerData } from 'worker_threads';
import { isArrayBuffer, isEmpty, isNil } from 'lodash';
import Vips from 'wasm-vips';
import type {
  IpcImageProcessorChannelName,
  IpcImageProcessorChannels,
  IpcImageProcessorRequest,
  IpcImageProcessorResponse,
  StaticOutputType,
  WithWebpFormat,
} from '../types/ipc/imageProcessorIpc';
import type {
  ImageProcessorValidFormat,
  UnknownFormat,
  VipsMetadata,
} from '../webworker/workers/node/image_processor/image_processor_types';

const DEBUG_IMAGE_PROCESSOR_WORKER = !isEmpty(process.env.DEBUG_IMAGE_PROCESSOR_WORKER);

function logIfOn(...args: Array<any>) {
  if (DEBUG_IMAGE_PROCESSOR_WORKER) {
    console.warn(...args);
  }
}

/**
 * iOS allows 5 seconds for converting images, and 2s for resizing.
 * We can't separate those two without making addition copies, so we use a timeout of 7s.
 */
const defaultTimeoutProcessingSeconds = 7;

/**
 * This is the default of sharp, but better to have it explicit in case they (or we) want to change it.
 */
const webpDefaultQuality = 80;

/**
 * Duplicated to be used in the worker environment
 */
const maxAvatarDetails = {
  /**
   * 600 px
   */
  maxSidePlanReupload: 600,
  /**
   * 200 px
   */
  maxSideNoReuploadRequired: 200,
};

let vips: typeof import('wasm-vips') | null = null;
let initPromise: Promise<typeof import('wasm-vips')> | null = null;

async function initVips() {
  if (vips) {
    return vips;
  }

  if (!initPromise) {
    // eslint-disable-next-line more/no-then
    initPromise = Vips({}).then(v => {
      vips = v;
      // Set cache limits
      vips.Cache.max(0);
      vips.Cache.maxMem(10000 * 1024 * 1024);
      vips.Cache.maxFiles(4000);

      logIfOn(`Worker ${workerData.workerId} initialized vips`);
      return v;
    });
  }
  logIfOn(`initVips done at `, Date.now());

  return initPromise;
}

type VipsFromOptions = { animated: boolean };

async function vipsFrom(inputBuffer: ArrayBufferLike, { animated }: VipsFromOptions) {
  const vipsLib = await initVips();

  const buffer = new Uint8Array(inputBuffer);

  const guessed = guessImageFormat(inputBuffer);

  if (animated && (guessed === 'gif' || guessed === 'webp')) {
    // passing `n=-1` will load all frames, but will throw if the image is not animated (jpeg, etc)
    try {
      const img = vipsLib.Image.newFromBuffer(buffer, 'n=-1').autorot();

      logIfOn(
        `vipsFrom: loaded all frames for "${guessed}" image. height/pageHeight: ${img.height}/${img.pageHeight}`
      );
      return img;
    } catch (_e) {
      logIfOn('vipsFrom: failed to load all frames. Retrying with single frame');
    }
  }
  return vipsLib.Image.newFromBuffer(buffer).autorot();
}

function formattedMetadata(metadata: {
  width: number | undefined;
  height: number | undefined;
  format: ImageProcessorValidFormat | UnknownFormat;
  size: number;
}) {
  const formatName = metadata.format.replace(/^\./, '');
  return `(${metadata.width}x${metadata.height}, format:${formatName} of ${metadata.size} bytes)`;
}

function isSupportedForOutput(format: ImageProcessorValidFormat | 'unknown') {
  return format === 'gif' || format === 'webp' || format === 'jpeg' || format === 'png';
}

function guessImageFormat(buffer: ArrayBufferLike): ImageProcessorValidFormat | UnknownFormat {
  const arr = new Uint8Array(buffer);
  // Copied from https://en.wikipedia.org/wiki/List_of_file_signatures

  if (arr[0] === 0xff && arr[1] === 0xd8 && arr[2] === 0xff) {
    return 'jpeg';
  }

  if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e && arr[3] === 0x47) {
    return 'png';
  }

  if (arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50) {
    return 'webp';
  }

  if (arr[0] === 0x47 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x38) {
    return 'gif';
  }

  return 'unknown';
}

function getVipsMetadata(image: Vips.Image, buffer: ArrayBufferLike): VipsMetadata {
  const detectedFormat = guessImageFormat(buffer);

  console.error('detectedFormat', detectedFormat);

  const pages =
    image.height && image.pageHeight ? Math.max(Math.floor(image.height / image.pageHeight), 1) : 1;
  console.warn('image', image);
  return {
    width: image.width,
    height: image.height,
    format: detectedFormat,
    contentType: detectedFormat !== 'unknown' ? `image/${detectedFormat}` : 'unknown',
    pages,
    size: buffer.byteLength,
  };
}

function metadataToFrameHeight(metadata: VipsMetadata) {
  const frameCount = Math.max(metadata.pages || 0, 1);
  const frameHeight =
    metadata.height && frameCount ? metadata.height / frameCount : metadata.height;
  return frameHeight;
}

/**
 * Wrapper around vips `metadata` as it throws if not a valid image, and we usually
 * want to just return null.
 *
 * Note: this will also orient a jpeg if needed. (i.e. calls rotate() through vipsFrom)
 * Note: metadata height will be set to the frame height, not the full height
 * of the canvas (as vips.metadata does with animated webp)
 */
async function metadataFromBuffer(
  inputBuffer: ArrayBufferLike,
  rethrow = false,
  options: VipsFromOptions
) {
  // Note: this might throw and we want to allow the error to be forwarded to the user if that happens.
  // A toast will display the error
  try {
    const metadata = getVipsMetadata(await vipsFrom(inputBuffer, options), inputBuffer);
    const frameHeight = metadataToFrameHeight(metadata);
    return { ...metadata, height: frameHeight };
  } catch (e) {
    logIfOn(`[imageProcessorWorker] metadataFromBuffer: failed with ${e.message}`);
    if (rethrow) {
      throw e;
    }
    return null;
  }
}

async function processForLinkPreviewThumbnail(
  data: IpcImageProcessorRequest<'processForLinkPreviewThumbnail'>
): Promise<IpcImageProcessorResponse<'processForLinkPreviewThumbnail'>> {
  const { buffer, maxSidePx } = data;

  let start = Date.now();
  const image: Vips.Image = await vipsFrom(buffer, { animated: false });
  logIfOn('processForLinkPreviewThumbnail: vipsFrom took', Date.now() - start);
  start = Date.now();
  // Resize & scale up if needed
  const resized = image.thumbnailImage(maxSidePx, {
    height: maxSidePx,
    size: vips!.Size.both,
    crop: vips!.Interesting.centre,
  });
  logIfOn('processForLinkPreviewThumbnail: thumbnailImage took', Date.now() - start);
  start = Date.now();
  const webpBuffer = resized.writeToBuffer('.webp', {
    Q: webpDefaultQuality,
  });
  logIfOn('processForLinkPreviewThumbnail: writeToBuffer took', Date.now() - start);

  return {
    outputBuffer: webpBuffer.buffer,
    width: resized.width,
    height: resized.pageHeight,
    size: webpBuffer.byteLength,
    contentType: 'image/webp' as const,
    format: 'webp' as const,
    isAnimated: false,
  };
}

async function processForInConversationThumbnail(
  data: IpcImageProcessorChannels['processForInConversationThumbnail']['request']
): Promise<IpcImageProcessorChannels['processForInConversationThumbnail']['response']> {
  const { buffer, maxSidePx } = data;

  const image: Vips.Image = await vipsFrom(buffer, { animated: false });

  // Resize & scale up if needed
  const resized = image.thumbnailImage(maxSidePx, {
    height: maxSidePx,
    size: vips!.Size.both,
    crop: vips!.Interesting.centre,
  });

  const webpBuffer = resized.writeToBuffer('.webp', {
    Q: webpDefaultQuality,
  });

  console.warn(
    'more todo,  (isAnimated) see "processForInConversationThumbnail: inputBuffer is required"'
  );

  return {
    outputBuffer: webpBuffer.buffer,
    width: resized.width,
    height: resized.pageHeight,
    size: webpBuffer.byteLength,
    contentType: 'image/webp' as const,
    format: 'webp' as const,
    isAnimated: false,
  };
}

async function testIntegrationFakeAvatar(
  data: IpcImageProcessorChannels['testIntegrationFakeAvatar']['request']
): Promise<IpcImageProcessorChannels['testIntegrationFakeAvatar']['response']> {
  const vipsLib = await initVips();
  const { background, maxSidePx } = data;

  // Resize & scale up if needed
  const created = vipsLib.Image.black(maxSidePx, maxSidePx, { bands: 3 }).linear(
    [1, 1, 1],
    [background.r, background.g, background.b]
  );
  const webpBuffer = created.writeToBuffer('.webp', {
    Q: webpDefaultQuality,
  });

  return {
    outputBuffer: webpBuffer.buffer,
    width: created.width,
    height: created.pageHeight,
    size: webpBuffer.byteLength,
    contentType: 'image/webp' as const,
    format: 'webp' as const,
    isAnimated: false,
  };
}

async function imageDimensions(data: IpcImageProcessorRequest<'imageDimensions'>) {
  const vipsLib = await initVips();
  const { buffer } = data;

  // Note: we probably don't want to autorot() here, as we want to get the dimensions of the original image
  const image: Vips.Image = vipsLib.Image.newFromBuffer(new Uint8Array(buffer));

  return {
    width: image.width,
    height: image.pageHeight,
  };
}

function isVipsImage(metadata: Vips.Image | VipsMetadata): metadata is Vips.Image {
  if (isNil((metadata as any).pages)) {
    return true;
  }
  return false;
}

function isAnimated(metadata: Vips.Image | VipsMetadata) {
  if (isVipsImage(metadata)) {
    return metadata.pageHeight < metadata.height;
  }

  return metadata.pages > 1;
}

async function extractFirstFrameWebp(
  inputBuffer: ArrayBufferLike
): Promise<(StaticOutputType & WithWebpFormat) | null> {
  if (!inputBuffer?.byteLength) {
    throw new Error('inputBuffer is required');
  }
  const inputMetadata = await vipsFrom(inputBuffer, { animated: true });
  if (!inputMetadata) {
    return null;
  }

  if (!isAnimated(inputMetadata)) {
    throw new Error('extractFirstFrameWebp: input is not animated');
  }

  // parse the buffer again but only the first page this time. (i.e the first frame)
  const src = await vipsFrom(inputBuffer, { animated: false });

  let start = Date.now();
  logIfOn('extractFirstFrameWebp: vipsFrom took', Date.now() - start);
  start = Date.now();

  // Note: the extracted avatar fallback is never used for reupload
  const resized = src.thumbnailImage(maxAvatarDetails.maxSideNoReuploadRequired, {
    height: maxAvatarDetails.maxSideNoReuploadRequired,
    size: vips!.Size.down, // Note: we only want to downscale, not upscale here
    crop: vips!.Interesting.centre,
  });
  logIfOn('extractFirstFrameWebp: thumbnailImage took', Date.now() - start);
  start = Date.now();
  const webpBuffer = resized.writeToBuffer('.webp', {
    Q: webpDefaultQuality,
  });
  logIfOn('extractFirstFrameWebp: writeToBuffer took', Date.now() - start);

  return {
    outputBuffer: webpBuffer.buffer,
    width: resized.width,
    height: resized.pageHeight,
    size: webpBuffer.byteLength,
    contentType: 'image/webp' as const,
    format: 'webp' as const,
  };
}

async function extractAvatarFallback({
  resizedBuffer,
  avatarIsAnimated,
}: {
  resizedBuffer: ArrayBufferLike;
  avatarIsAnimated: boolean;
}) {
  if (!avatarIsAnimated) {
    return null;
  }
  const firstFrameWebp = await extractFirstFrameWebp(resizedBuffer);
  if (!firstFrameWebp) {
    throw new Error('extractAvatarFallback: failed to extract first frame as webp');
  }
  // the fallback (static image out of an animated one) is always a webp
  const fallbackFormat = 'webp' as const;

  if (
    firstFrameWebp.height > maxAvatarDetails.maxSideNoReuploadRequired ||
    firstFrameWebp.width > maxAvatarDetails.maxSideNoReuploadRequired
  ) {
    throw new Error(
      'extractAvatarFallback: fallback image is too big. Have you provided the correct resizedBuffer?'
    );
  }

  return {
    outputBuffer: firstFrameWebp.outputBuffer,
    height: firstFrameWebp.height, // this one is only the frame height already. No need for `metadataToFrameHeight`
    width: firstFrameWebp.width,
    format: fallbackFormat,
    contentType: `image/${fallbackFormat}` as const,
    size: firstFrameWebp.size,
  };
}

async function extractMainAvatarDetails({
  isSourceGif,
  planForReupload,
  resizedBuffer,
  resizedMetadata,
}: {
  resizedBuffer: ArrayBufferLike;
  resizedMetadata: VipsMetadata;
  planForReupload: boolean;
  isSourceGif: boolean;
}) {
  const resizedIsAnimated = isAnimated(resizedMetadata);

  return {
    outputBuffer: resizedBuffer,
    height: resizedMetadata.height,
    width: resizedMetadata.width,
    isAnimated: resizedIsAnimated,
    format: planForReupload && isSourceGif ? ('gif' as const) : ('webp' as const),
    contentType: planForReupload && isSourceGif ? ('image/gif' as const) : ('image/webp' as const),
    size: resizedBuffer.byteLength,
  };
}

async function sleepFor(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function processPlanForReuploadAvatar({
  inputBuffer,
  remoteChange,
}: {
  inputBuffer: ArrayBufferLike;
  remoteChange: boolean;
}) {
  const start = Date.now();

  const metadata = await metadataFromBuffer(inputBuffer, true, { animated: true });
  if (!metadata) {
    return null;
  }

  /**
   * This is not pretty, but when we download our own avatar from the network and we didn't set it locally,
   * we need to make sure a reupload will be planned if required.
   * What this means is that, if we get an avatar of size 640 from the network we should plan for a reupload.
   * But, if we resize it here to 600, the AvatarReuploadJob will be skipped as the avatar is already the correct size.
   * As a hack, we add 1 pixel to the size required when this is a remote change, so that the AvatarReuploadJob will be triggered.
   *
   * Note: We do not upscale the file if it's already smaller than 600px, so a reupload won't be triggered if a device set an avatar to 600 already.
   */
  const sizeRequired = remoteChange
    ? maxAvatarDetails.maxSidePlanReupload + 1
    : maxAvatarDetails.maxSidePlanReupload;
  const avatarIsAnimated = isAnimated(metadata);

  if (avatarIsAnimated && metadata.format !== 'webp' && metadata.format !== 'gif') {
    throw new Error('processPlanForReuploadAvatar: we only support animated images in webp or gif');
  }

  // When planning for reupload, the rules about gif/webp are quite different that when not planning for reupload.
  // Essentially, we want to try to resize a gif to webp, but if it takes too long or the resulting file size is too big, we will just use the original gif.
  const isSourceGif = metadata.format === 'gif';
  if (
    metadata.width <= sizeRequired &&
    metadata.height <= sizeRequired &&
    metadata.format === 'webp'
  ) {
    // It appears this avatar is already small enough and of the correct format, so we don't want to resize it.
    // We still want to extract the first frame of the animated avatar, if it is animated though.

    // also extract the first frame of the resized (animated) avatar
    const avatarFallback = await extractAvatarFallback({
      resizedBuffer: inputBuffer,
      avatarIsAnimated,
    });
    const mainAvatarDetails = await extractMainAvatarDetails({
      resizedBuffer: inputBuffer, // we can just reuse the input buffer here as the dimensions and format are correct
      resizedMetadata: metadata,
      planForReupload: true,
      isSourceGif,
    });

    logIfOn(
      `[imageProcessorWorker] processPlanForReuploadAvatar sizes (already correct sizes & format): main: ${inputBuffer.byteLength} bytes, fallback: ${avatarFallback ? avatarFallback.size : 0} bytes`
    );

    return {
      mainAvatarDetails,
      avatarFallback,
    };
  }

  let awaited: ArrayBufferLike | undefined;

  // if the avatar was animated, we want an animated webp.
  // if it was static, we want a static webp.
  if (isSourceGif) {
    logIfOn(
      `[imageProcessorWorker] src is gif, trying to convert to webp with timeout of ${defaultTimeoutProcessingSeconds}s`
    );

    // We want to try to convert a gif to webp, but if it takes too long or the resulting file size is too big, we will just use the original gif.
    // const raced = await Promise.race([
    //   webpResize(),
    //   sleepFor(defaultTimeoutProcessingSeconds * 1000),
    // ]);

    console.warn('start webpRessize');
    const webpStart = Date.now();

    const im = vips!.Image.thumbnailBuffer(inputBuffer, sizeRequired, {
      height: sizeRequired,
      crop: vips!.Interesting.none,
      size: vips!.Size.down,
    });
    const processedImage = im.writeToBuffer('.webp', { Q: webpDefaultQuality });
    im.delete();
    const raced = processedImage.buffer;

    console.warn('end webpResize took', Date.now() - webpStart);

    if (isArrayBuffer(raced)) {
      logIfOn(
        `[imageProcessorWorker] processPlanForReuploadAvatar: gif conversion took ${Date.now() - start}ms for ${raced.byteLength} bytes`
      );
      awaited = raced;
    } else {
      logIfOn(`[imageProcessorWorker] processPlanForReuploadAvatar: gif conversion failed`);
    }
    if (!isArrayBuffer(awaited) || awaited.byteLength > inputBuffer.byteLength) {
      logIfOn(
        `[imageProcessorWorker] isSourceGif & gif conversion failed, using original gif without resize`
      );
      // we failed to process the gif fast enough, or the resulting webp is bigger than the original gif. Fallback to the original gif.
      awaited = inputBuffer;
    }
  } else {
    const plopStart = Date.now();
    // when not planning for reupload, we always want a webp, and no timeout for that
    console.warn('start webpRessize');
    const webpStart = Date.now();

    const im = vips!.Image.thumbnailBuffer(inputBuffer, sizeRequired, {
      height: sizeRequired,
      crop: vips!.Interesting.none,
      size: vips!.Size.down,
    });
    const processedImage = im.writeToBuffer('.webp', { Q: webpDefaultQuality });
    im.delete();
    awaited = processedImage.buffer;
    console.warn('end webpResize took', Date.now() - webpStart);

    logIfOn(
      `[imageProcessorWorker] always webp conversion took ${Date.now() - start}ms for ${awaited.byteLength} bytes (part only: ${Date.now() - plopStart}ms)`
    );
  }

  if (!isArrayBuffer(awaited)) {
    throw new Error('Image processing failed for an unknown reason');
  }

  const resizedBuffer = awaited;
  logIfOn(
    `[imageProcessorWorker] about to parse metadata from resized buffer of size ${resizedBuffer.byteLength}`
  );
  // Note: we need to use the resized buffer here, not the original one,
  // as metadata is always linked to the source buffer (even if a resize() is done before the metadata call)
  const resizedMetadata = await metadataFromBuffer(resizedBuffer, undefined, { animated: true });
  logIfOn(
    `[imageProcessorWorker] parsed resized metadata: ${resizedMetadata ? formattedMetadata(resizedMetadata) : 'null'}`
  );

  if (!resizedMetadata) {
    return null;
  }

  logIfOn(
    `[imageProcessorWorker] processPlanForReuploadAvatar mainAvatar resize took ${Date.now() - start}ms for ${inputBuffer.byteLength} bytes`
  );

  const resizedIsAnimated = isAnimated(resizedMetadata);

  // also extract the first frame of the resized (animated) avatar
  const avatarFallback = await extractAvatarFallback({
    resizedBuffer,
    avatarIsAnimated: resizedIsAnimated,
  });

  logIfOn(
    `[imageProcessorWorker] processPlanForReuploadAvatar sizes: main: ${resizedMetadata.size} bytes, fallback: ${avatarFallback ? avatarFallback.size : 0} bytes`
  );
  const mainAvatarDetails = await extractMainAvatarDetails({
    resizedBuffer,
    resizedMetadata,
    planForReupload: true,
    isSourceGif,
  });

  return {
    mainAvatarDetails,
    avatarFallback,
  };
}

async function processNoPlanForReuploadAvatar({ inputBuffer }: { inputBuffer: ArrayBufferLike }) {
  const start = Date.now();
  const sizeRequired = maxAvatarDetails.maxSideNoReuploadRequired;
  const metadata = await metadataFromBuffer(inputBuffer, false, { animated: true });

  if (!metadata) {
    return null;
  }
  const avatarIsAnimated = isAnimated(metadata);

  if (avatarIsAnimated && metadata.format !== 'webp' && metadata.format !== 'gif') {
    throw new Error(
      'processNoPlanForReuploadAvatar: we only support animated images in webp or gif'
    );
  }
  // Not planning for reupload. We always generate a webp instead for the main avatar.
  if (
    metadata.width <= sizeRequired &&
    metadata.height <= sizeRequired &&
    metadata.format === 'webp'
  ) {
    // It appears this avatar is already small enough and of the correct format, so we don't want to resize it.
    // We still want to extract the first frame of the animated avatar, if it is animated though.

    // also extract the first frame of the resized (animated) avatar
    const avatarFallback = await extractAvatarFallback({
      resizedBuffer: inputBuffer,
      avatarIsAnimated,
    });
    const mainAvatarDetails = await extractMainAvatarDetails({
      resizedBuffer: inputBuffer, // we can just reuse the input buffer here as the dimensions and format are correct
      resizedMetadata: metadata,
      planForReupload: false,
      isSourceGif: false,
    });

    logIfOn(
      `[imageProcessorWorker] processNoPlanForReuploadAvatar sizes (already correct sizes): main: ${inputBuffer.byteLength} bytes, fallback: ${avatarFallback ? avatarFallback.size : 0} bytes`
    );

    return {
      mainAvatarDetails,
      avatarFallback,
    };
  }

  // generate a square image of the avatar, scaled down or up to `maxSide`
  const src = await vipsFrom(inputBuffer, { animated: true });
  const resized = src.thumbnailImage(sizeRequired, {
    height: sizeRequired,
    size: vips!.Size.both,
    crop: vips!.Interesting.centre,
  });

  // when not planning for reupload, we always want a webp for the main avatar (and we do not care about how long that takes)
  const resizedBuffer = resized.writeToBuffer('.webp[n=-1]', { Q: webpDefaultQuality });

  // Note: we need to use the resized buffer here, not the original one,
  // as metadata is always linked to the source buffer (even if a resize() is done before the metadata call)
  const resizedMetadata = await metadataFromBuffer(resizedBuffer.buffer, undefined, {
    animated: true,
  });

  if (!resizedMetadata) {
    return null;
  }

  logIfOn(
    `[imageProcessorWorker] processNoPlanForReuploadAvatar mainAvatar resize took ${Date.now() - start}ms for ${inputBuffer.byteLength} bytes`
  );

  const resizedIsAnimated = isAnimated(resizedMetadata);
  const resizedMetadataSize = resizedMetadata.size;

  // also extract the first frame of the resized (animated) avatar
  const avatarFallback = await extractAvatarFallback({
    resizedBuffer: resizedBuffer.buffer,
    avatarIsAnimated: resizedIsAnimated,
  });

  logIfOn(
    `[imageProcessorWorker] processNoPlanForReuploadAvatar sizes: main: ${resizedMetadataSize} bytes, fallback: ${avatarFallback ? avatarFallback.size : 0} bytes`
  );
  const mainAvatarDetails = await extractMainAvatarDetails({
    resizedBuffer: resizedBuffer.buffer,
    resizedMetadata,
    planForReupload: false,
    isSourceGif: false, // we always generate a webp here so we do not care if the src was a gif.
  });

  return {
    mainAvatarDetails,
    avatarFallback,
  };
}

async function processAvatarData({
  buffer,
  planForReupload,
  remoteChange,
}: IpcImageProcessorRequest<'processAvatarData'>) {
  if (!buffer?.byteLength) {
    throw new Error('processAvatarData: buffer is required');
  }

  if (planForReupload) {
    return processPlanForReuploadAvatar({ inputBuffer: buffer, remoteChange });
  }
  return processNoPlanForReuploadAvatar({ inputBuffer: buffer });
}

async function processForFileServerUpload({
  buffer: inputBuffer,
  maxSidePx,
  maxSizeBytes,
}: IpcImageProcessorRequest<'processForFileServerUpload'>) {
  if (!inputBuffer?.byteLength) {
    throw new Error('processForFileServerUpload: inputBuffer is required');
  }

  const lossyFormats = ['jpeg', 'webp', 'avif'];
  const start = Date.now();
  const metadata = await metadataFromBuffer(inputBuffer, false, { animated: true });
  console.warn('metadata', metadata);
  if (
    !metadata ||
    !metadata.format ||
    !isSupportedForOutput(metadata.format) ||
    !metadata.width ||
    !metadata.height
  ) {
    logIfOn(`Unsupported format: ${metadata?.format}`);
    return null;
  }

  const animated = isAnimated(metadata);

  const isLossyFormat = lossyFormats.includes(metadata.format);

  // Note: this will resize
  const isLossyFormatButFits =
    isLossyFormat &&
    inputBuffer.byteLength < maxSizeBytes &&
    metadata.width <= maxSidePx &&
    metadata.height <= maxSidePx;

  // If the image is lossy but fits in the max size, we can just return it as is.
  // This is to speed up large image additions to the staged attachments list.
  if (isLossyFormatButFits) {
    logIfOn(
      `isLossyFormatButFits: returning buffer of size ${metadata.size} and WxH: ${metadata.width}x${metadata.height}`
    );

    return {
      format: metadata.format,
      outputBuffer: inputBuffer,
      size: metadata.size,
      width: metadata.width,
      height: metadata.height, // this one is only the frame height already, no need for `metadataToFrameHeight`
      isAnimated: isAnimated(metadata),
    };
  }

  // If image is lossless, we cannot adjust the quality and we assume we don't want to scale it down either (as it can be slow)
  // so just return the source buffer
  if (!isLossyFormat) {
    if (inputBuffer.byteLength >= maxSizeBytes) {
      logIfOn(`not lossy format and does not fit`);

      return null;
    }

    logIfOn(
      `not lossy format but fits, returning buffer of size ${metadata.size} and WxH: ${metadata.width}x${metadata.height}`
    );

    return {
      format: metadata.format,
      outputBuffer: inputBuffer,
      size: metadata.size,
      width: metadata.width,
      height: metadata.height, // this one is only the frame height already, no need for `metadataToFrameHeight`
      isAnimated: isAnimated(metadata),
    };
  }

  const base = await vipsFrom(inputBuffer, { animated });
  let resized: Vips.Image | undefined;

  // Resize if needed
  if (metadata.width > maxSidePx || metadata.height > maxSidePx) {
    // Resize & scale up if needed
    resized = base.thumbnailImage(maxSidePx, {
      height: maxSidePx,
      size: vips!.Size.both,
      crop: vips!.Interesting.centre,
    });
  }

  // if we can't get a picture with a quality of more than 30, consider it a failure and return null
  const qualityRange = [85, 75, 55, 30] as const;
  for (const quality of qualityRange) {
    let buffer: ArrayBufferLike | undefined;
    switch (metadata.format) {
      case 'webp':
      case 'jpeg':
        buffer = (resized ?? base).writeToBuffer(`.${metadata.format}`, { Q: quality }).buffer;

        break;
      default:
        throw new Error(`Unsupported format: ${metadata.format}`);
    }

    if (!buffer) {
      throw new Error('Failed to get a buffer');
    }

    if (buffer.byteLength < maxSizeBytes) {
      // eslint-disable-next-line no-await-in-loop
      const outputMetadata = await metadataFromBuffer(buffer, false, { animated: true });

      if (!outputMetadata) {
        return null;
      }

      logIfOn(
        `[imageProcessorWorker] processForFileServerUpload: DONE quality ${quality} took ${
          Date.now() - start
        }ms for}`
      );
      logIfOn(
        `\t src${formattedMetadata({ width: metadata.width, height: metadata.height, format: metadata.format, size: inputBuffer.byteLength })} `
      );
      logIfOn(
        `\t dest${formattedMetadata({ width: outputMetadata.width, height: outputMetadata.height, format: metadata.format, size: buffer.byteLength })} `
      );

      return {
        format: outputMetadata.format,
        outputBuffer: buffer,
        size: metadata.size,
        width: outputMetadata.width,
        height: outputMetadata.height, // this one is only the frame height already, no need for `metadataToFrameHeight`
        isAnimated: isAnimated(outputMetadata),
      };
    }
    logIfOn(
      `[imageProcessorWorker] processForFileServerUpload: took so far ${
        Date.now() - start
      }ms with quality ${quality}`
    );
    logIfOn(
      `\t src${formattedMetadata({ width: metadata.width, height: metadata.height, format: metadata.format, size: inputBuffer.byteLength })} `
    );
  }

  logIfOn(
    `[imageProcessorWorker] processForFileServerUpload: failed to get a buffer of size ${maxSizeBytes} for ${inputBuffer.byteLength} bytes for image of ${metadata.width}x${metadata.height} with format ${metadata.format}`
  );
  logIfOn(
    `[imageProcessorWorker] processForFileServerUpload: failed after ${Date.now() - start}ms`
  );
  logIfOn(
    `\t src${formattedMetadata({ width: metadata.width, height: metadata.height, format: metadata.format, size: inputBuffer.byteLength })} `
  );

  return null;
}

parentPort?.on(
  'message',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async (message: {
    id: number;
    operation: IpcImageProcessorChannelName;
    data: IpcImageProcessorRequest<any>;
  }) => {
    const { id, operation, data } = message;

    try {
      let result;

      switch (operation) {
        case 'processForLinkPreviewThumbnail':
          result = await processForLinkPreviewThumbnail(data);
          break;

        case 'processForInConversationThumbnail':
          result = await processForInConversationThumbnail(data);
          break;

        case 'testIntegrationFakeAvatar':
          result = await testIntegrationFakeAvatar(data);
          break;

        case 'imageDimensions':
          result = await imageDimensions(data);
          break;

        case 'processAvatarData':
          result = await processAvatarData(data);
          break;

        case 'processForFileServerUpload':
          result = await processForFileServerUpload(data);
          break;

        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      parentPort?.postMessage({ id, result });
    } catch (error) {
      console.error(`Worker ${workerData.workerId} error:`, error);
      parentPort?.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

logIfOn(`Worker ${workerData.workerId} started`);

// eslint-disable-next-line more/no-then
initVips()
  .then(() => {
    console.error(`Worker ${workerData.workerId} init vips OK`);
  })
  .catch(err => {
    console.error(`Worker ${workerData.workerId} failed to init vips:`, err);
  });
