import { isBuffer, isEmpty, isFinite, isNil, isNumber } from 'lodash';
import Vips from '../../node_modules/wasm-vips/lib/vips.js';
import type {
  ImageProcessorValidFormat,
  UnknownFormat,
  VipsMetadata,
} from './workers/node/image_processor/image_processor_types';

/* eslint-disable no-console */
/* eslint-disable strict */

let vips: typeof import('wasm-vips') | null = null;

async function initVips() {
  if (!vips) {
    console.log('about to init Vips');

    // Fetch the WASM file manually
    // const wasmPath = '../../../../../node_modules/wasm-vips/lib/vips.wasm';
    // const response = await fetch(wasmPath);
    // const wasmBinary = await response.arrayBuffer();

    // console.log('WASM loaded, size:', wasmBinary.byteLength);

    vips = await Vips({
      // wasmBinary: wasmBinary,
      // dynamicLibraries: [],
      locateFile: (file: string, scriptDirectory: string) => {
        console.log(`[Vips locateFile]: ${file} scriptDirectory: ${scriptDirectory}`);
        return `./wasm/${file}`;
      },
      // mainScriptUrlOrBlob: undefined, // Disable worker threads
      print: (text: string) => console.log('[Vips print]:', text),
      printErr: (text: string) => console.error('[Vips error]:', text),
    });
    // Debug: Log what's actually available
    console.error('Vips initialized:', vips);
    console.error('Vips.Image:', vips.Image);
    console.error('Available methods:', Object.keys(vips));
  }
  return vips;
}

const DEBUG_IMAGE_PROCESSOR_WORKER = !isEmpty(process.env.DEBUG_IMAGE_PROCESSOR_WORKER);

function logIfOn(...args: Array<any>) {
  if (DEBUG_IMAGE_PROCESSOR_WORKER) {
    console.log(...args);
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

function isNotIterable(value) {
  // Exclude null and undefined as they are not iterable.
  if (isNil(value)) {
    return true;
  }
  // Check if the Symbol.iterator method is not a function.
  // If it's not a function or doesn't exist, the object is not iterable.
  return typeof value[Symbol.iterator] !== 'function';
}

function metadataSizeIsSetOrThrow(metadata: VipsMetadata, identifier: string) {
  if (!isNumber(metadata.size) || !isFinite(metadata.size)) {
    debugger;
    throw new Error(`assertMetadataSizeIsSet: ${identifier} metadata.size is not set`);
  }

  return metadata.size;
}

function isAnimated(metadata: VipsMetadata) {
  return (metadata.pages || 0) > 1;
}

function thumbnailCover(
  image: Vips.Image,
  {
    maxSidePx,
    withoutEnlargement,
  }: {
    maxSidePx: number;
    withoutEnlargement: boolean;
  }
): Vips.Image {
  const currentWidth = image.width;
  const currentHeight = image.height;

  console.log('Image object:', image);

  // Check if we should skip enlargement
  if (withoutEnlargement && currentWidth <= maxSidePx && currentHeight <= maxSidePx) {
    return image;
  }

  // Calculate scale to cover the target size (like Sharp's 'cover' fit)
  const scaleX = maxSidePx / currentWidth;
  const scaleY = maxSidePx / currentHeight;
  const scale = Math.max(scaleX, scaleY); // Use max for 'cover' behavior

  // Calculate intermediate dimensions
  const scaledWidth = Math.round(currentWidth * scale);
  const scaledHeight = Math.round(currentHeight * scale);

  // Resize the image
  const resized = image.resize(scale);

  // Extract (crop) the center portion to exactly maxSidePx x maxSidePx
  const left = Math.round((scaledWidth - maxSidePx) / 2);
  const top = Math.round((scaledHeight - maxSidePx) / 2);

  return resized.crop(left, top, maxSidePx, maxSidePx);
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

type vipsFromOptions = { animated: boolean };

async function vipsFrom(inputBuffer: ArrayBufferLike | Buffer, { animated }: vipsFromOptions) {
  const vipsLib = await initVips();

  const buffer =
    inputBuffer instanceof Buffer ? new Uint8Array(inputBuffer) : new Uint8Array(inputBuffer);

  // Load with all frames if animated is true
  const loadOptions = animated ? `n=-1` : '';
  const image = vipsLib.Image.newFromBuffer(buffer, loadOptions);

  // Auto-rotate based on EXIF orientation
  return image.autorot();
}

function metadataToFrameHeight(metadata: VipsMetadata) {
  const frameCount = Math.max(metadata.pages || 0, 1);
  const frameHeight =
    metadata.height && frameCount ? metadata.height / frameCount : metadata.height;
  return frameHeight;
}

function isSupportedForOutput(format: ImageProcessorValidFormat | 'unknown') {
  return format === 'gif' || format === 'webp' || format === 'jpeg' || format === 'png';
}

function getVipsMetadata(image: Vips.Image): VipsMetadata {
  console.warn('filter image', image);
  let detectedFormat: ImageProcessorValidFormat | undefined;
  // try {
  //   // Check for format-specific metadata
  //   const vipsLoader = image.get('vips-loader');

  //   // Map vips loader names to MIME types
  //   const loaderToMime: Record<string, ImageProcessorValidFormat> = {
  //     jpegload_buffer: 'jpeg',
  //     pngload_buffer: 'png',
  //     webpload_buffer: 'webp',
  //     gifload_buffer: 'gif',
  //   };

  //   detectedFormat = loaderToMime[vipsLoader];
  // } catch (e) {
  //   // vips-loader might not be available
  //   console.error('vips-loader not available', e);
  // }
  // if (!detectedFormat) {
  //   console.warn('failed to detect image format');
  // }

  console.error('detectedFormat', detectedFormat);

  const pages = Math.max(Math.floor(image.height / image.pageHeight), 1);
  console.warn('image', image);
  return {
    width: image.width,
    height: image.height,
    format: detectedFormat ?? 'unknown',
    contentType: detectedFormat ? `image/${detectedFormat}` : 'unknown',
    pages,
  };
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
  inputBuffer: ArrayBufferLike | Buffer,
  rethrow = false,
  options?: Pick<vipsFromOptions, 'animated'>
) {
  // Note: this might throw and we want to allow the error to be forwarded to the user if that happens.
  // A toast will display the error
  try {
    const metadata = getVipsMetadata(await vipsFrom(inputBuffer, options));
    const frameHeight = metadataToFrameHeight(metadata);
    return { ...metadata, height: frameHeight };
  } catch (e) {
    if (rethrow) {
      throw e;
    }
    return null;
  }
}

async function extractFirstFrameWebp(
  inputBuffer: ArrayBufferLike
): Promise<(StaticOutputType & WithWebpFormat) | null> {
  if (!inputBuffer?.byteLength) {
    throw new Error('inputBuffer is required');
  }
  const inputMetadata = await metadataFromBuffer(inputBuffer);
  if (!inputMetadata) {
    return null;
  }

  metadataSizeIsSetOrThrow(inputMetadata, 'extractFirstFrameWebp');

  if (!isAnimated(inputMetadata)) {
    throw new Error('extractFirstFrameWebp: input is not animated');
  }

  const src = await vipsFrom(inputBuffer, { animated: false });
  const cover = await thumbnailCover(src, {
    // Note: the extracted avatar fallback is never used for reupload
    maxSidePx: maxAvatarDetails.maxSideNoReuploadRequired,
    withoutEnlargement: true,
  });
  const webp = cover.webp({ quality: webpDefaultQuality });

  const outputBuffer = await webp.toBuffer();
  const outputMetadata = await metadataFromBuffer(outputBuffer);
  if (!outputMetadata) {
    return null;
  }

  const outputMetadataSize = metadataSizeIsSetOrThrow(outputMetadata, 'extractFirstFrameWebp');

  if (isAnimated(outputMetadata)) {
    throw new Error('extractFirstFrameWebp: outputMetadata cannot be animated');
  }

  return {
    outputBuffer: outputBuffer.buffer,
    width: outputMetadata.width,
    height: outputMetadata.height, // this one is only the frame height already, no need for `metadataToFrameHeight`
    size: outputMetadataSize,
    format: 'webp' as const,
    contentType: 'image/webp' as const,
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
  const resizedMetadataSize = metadataSizeIsSetOrThrow(resizedMetadata, 'extractMainAvatarDetails');

  return {
    outputBuffer: resizedBuffer,
    height: resizedMetadata.height,
    width: resizedMetadata.width,
    isAnimated: resizedIsAnimated,
    format: planForReupload && isSourceGif ? ('gif' as const) : ('webp' as const),
    contentType: planForReupload && isSourceGif ? ('image/gif' as const) : ('image/webp' as const),
    size: resizedMetadataSize,
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
  const resizeOpts = centerCoverOpts({
    maxSidePx: sizeRequired,
    withoutEnlargement: true,
  });

  let awaited: any;
  // if the avatar was animated, we want an animated webp.
  // if it was static, we want a static webp.
  if (isSourceGif) {
    logIfOn(
      `[imageProcessorWorker] src is gif, trying to convert to webp with timeout of ${defaultTimeoutProcessingSeconds}s`
    );
    const src = await vipsFrom(inputBuffer, { animated: true });
    // See the comment in image_processor.d.ts:
    // We want to try to convert a gif to webp, but if it takes too long or the resulting file size is too big, we will just use the original gif.
    awaited = await Promise.race([
      src.resize(resizeOpts).webp().toBuffer(),
      sleepFor(defaultTimeoutProcessingSeconds * 1000), // it seems that timeout is not working as expected in sharp --'
    ]);
    if (awaited && isBuffer(awaited)) {
      logIfOn(
        `[imageProcessorWorker] processPlanForReuploadAvatar: gif conversion took ${Date.now() - start}ms for ${awaited.byteLength} bytes`
      );
    } else {
      logIfOn(`[imageProcessorWorker] processPlanForReuploadAvatar: gif conversion failed`);
    }
  } else {
    // when not planning for reupload, we always want a webp, and no timeout for that
    awaited = await vipsFrom(inputBuffer, { animated: true })
      .resize(resizeOpts)
      .webp({ quality: webpDefaultQuality })
      .toBuffer();
    logIfOn(
      `[imageProcessorWorker] always webp conversion took ${Date.now() - start}ms for ${awaited.byteLength} bytes`
    );
  }

  if (isSourceGif && (!isBuffer(awaited) || awaited.byteLength > inputBuffer.byteLength)) {
    logIfOn(
      `[imageProcessorWorker] isSourceGif & gif conversion failed, using original gif without resize`
    );
    // we failed to process the gif fast enough, or the resulting webp is bigger than the original gif. Fallback to the original gif.
    awaited = Buffer.from(inputBuffer);
  }

  if (!isBuffer(awaited)) {
    throw new Error('Image processing failed for an unknown reason');
  }

  const resizedBuffer = awaited as Buffer;

  // Note: we need to use the resized buffer here, not the original one,
  // as metadata is always linked to the source buffer (even if a resize() is done before the metadata call)
  const resizedMetadata = await metadataFromBuffer(resizedBuffer);

  if (!resizedMetadata) {
    return null;
  }

  const resizedMetadataSize = metadataSizeIsSetOrThrow(
    resizedMetadata,
    'processPlanForReuploadAvatar'
  );

  logIfOn(
    `[imageProcessorWorker] processPlanForReuploadAvatar mainAvatar resize took ${Date.now() - start}ms for ${inputBuffer.byteLength} bytes`
  );

  const resizedIsAnimated = isAnimated(resizedMetadata);

  // also extract the first frame of the resized (animated) avatar
  const avatarFallback = await extractAvatarFallback({
    resizedBuffer: resizedBuffer.buffer,
    avatarIsAnimated: resizedIsAnimated,
  });

  logIfOn(
    `[imageProcessorWorker] processPlanForReuploadAvatar sizes: main: ${resizedMetadataSize} bytes, fallback: ${avatarFallback ? avatarFallback.size : 0} bytes`
  );
  const mainAvatarDetails = await extractMainAvatarDetails({
    resizedBuffer: resizedBuffer.buffer,
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
  const resized = vipsFrom(inputBuffer, { animated: true }).resize(
    centerCoverOpts({
      maxSidePx: sizeRequired,
      withoutEnlargement: true,
    })
  );

  // when not planning for reupload, we always want a webp for the main avatar (and we do not care about how long that takes)
  const resizedBuffer = await resized.webp({ quality: webpDefaultQuality }).toBuffer();

  // Note: we need to use the resized buffer here, not the original one,
  // as metadata is always linked to the source buffer (even if a resize() is done before the metadata call)
  const resizedMetadata = await metadataFromBuffer(resizedBuffer);

  if (!resizedMetadata) {
    return null;
  }

  const resizedMetadataSize = metadataSizeIsSetOrThrow(
    resizedMetadata,
    'processNoPlanForReuploadAvatar'
  );

  logIfOn(
    `[imageProcessorWorker] processNoPlanForReuploadAvatar mainAvatar resize took ${Date.now() - start}ms for ${inputBuffer.byteLength} bytes`
  );

  const resizedIsAnimated = isAnimated(resizedMetadata);

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

export async function imageMetadata(inputBuffer: ArrayBuffer) {
  if (!inputBuffer?.byteLength) {
    throw new Error('imageMetadata: inputBuffer is required');
  }

  const metadata = await metadataFromBuffer(inputBuffer, false, { animated: true });

  if (!metadata) {
    return null;
  }

  const metadataSize = metadataSizeIsSetOrThrow(metadata, 'imageMetadata');

  return {
    size: metadataSize,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    isAnimated: isAnimated(metadata),
  };
}

export async function processAvatarData(
  inputBuffer: ArrayBufferLike,
  planForReupload: boolean,
  remoteChange: boolean
) {
  if (!inputBuffer?.byteLength) {
    throw new Error('processAvatarData: inputBuffer is required');
  }

  if (planForReupload) {
    return await processPlanForReuploadAvatar({ inputBuffer, remoteChange });
  }
  return await processNoPlanForReuploadAvatar({ inputBuffer });
}

export async function testIntegrationFakeAvatar(
  maxSidePx: number,
  background: { r: number; g: number; b: number }
) {
  const vipsLib = await initVips();

  // Create a new image with solid color background
  const created = vipsLib.Image.black(maxSidePx, maxSidePx, { bands: 3 }).linear(
    [1, 1, 1],
    [background.r, background.g, background.b]
  );

  // Convert to WebP with quality setting
  const createdBuffer = created.writeToBuffer('.webp', {
    Q: webpDefaultQuality, // Q is the quality parameter in libvips
  });

  const createdMetadata = await metadataFromBuffer(createdBuffer.buffer);

  if (!createdMetadata) {
    throw new Error('testIntegrationFakeAvatar: failed to get metadata');
  }

  const size = metadataSizeIsSetOrThrow(createdMetadata, 'testIntegrationFakeAvatar');

  const format = 'webp' as const;
  return {
    outputBuffer: createdBuffer.buffer,
    height: createdMetadata.height,
    width: createdMetadata.width,
    isAnimated: false,
    format,
    contentType: `image/${format}` as const,
    size,
  };
}

export async function processForLinkPreviewThumbnail(
  inputBuffer: ArrayBufferLike,
  maxSidePx: number
) {
  if (!inputBuffer?.byteLength) {
    throw new Error('processForLinkPreviewThumbnail: inputBuffer is required');
  }

  const parsed = await vipsFrom(inputBuffer, { animated: false });
  const metadata = await metadataFromBuffer(inputBuffer, false, { animated: false });

  if (!metadata) {
    return null;
  }

  // for thumbnail, we actually want to enlarge the image if required
  const resized = thumbnailCover(parsed, { maxSidePx, withoutEnlargement: false });
  console.warn('before writeToBuffer', resized);
  const resizedBuffer = resized.writeToBuffer('.webp', { Q: webpDefaultQuality });
  console.warn('after writeToBuffer', resizedBuffer);

  const resizedMetadata = await metadataFromBuffer(resizedBuffer.buffer);
  console.warn('after resizedMetadata', resizedMetadata);

  metadataSizeIsSetOrThrow(metadata, 'processForLinkPreviewThumbnail');
  if (!resizedMetadata) {
    return null;
  }

  const resizedSize = metadataSizeIsSetOrThrow(resizedMetadata, 'processForLinkPreviewThumbnail');

  const format = 'webp' as const;

  return {
    outputBuffer: resizedBuffer.buffer,
    height: resizedMetadata.height,
    width: resizedMetadata.width,
    format,
    contentType: `image/${format}` as const,
    size: resizedSize,
  };
}

export async function processForInConversationThumbnail(
  inputBuffer: ArrayBufferLike,
  maxSidePx: number
) {
  if (!inputBuffer?.byteLength) {
    throw new Error('processForInConversationThumbnail: inputBuffer is required');
  }

  // Note: this `animated` is false here because we want to force a static image (so no need to extract all the frames)
  const src = await vipsFrom(inputBuffer, { animated: false });

  const parsed = thumbnailCover(src, {
    maxSidePx,
    withoutEnlargement: false, // We actually want to enlarge the image if required for a thumbnail in conversation
  });
  const metadata = await metadataFromBuffer(inputBuffer, false, { animated: false });

  if (!metadata) {
    return null;
  }

  const animated = isAnimated(metadata);

  const awaited = await Promise.race([
    parsed.webp({ quality: webpDefaultQuality }).toBuffer(),
    sleepFor(defaultTimeoutProcessingSeconds * 1000), // it seems that timeout is not working as expected in sharp --'
  ]);

  if (!isBuffer(awaited)) {
    throw new Error('Image processing timed out');
  }

  const resizedBuffer = awaited as Buffer;
  const resizedMetadata = await metadataFromBuffer(resizedBuffer);

  if (!resizedMetadata) {
    return null;
  }

  const size = metadataSizeIsSetOrThrow(resizedMetadata, 'processForInConversationThumbnail');

  const formatDetails = { format: 'webp' as const, contentType: 'image/webp' as const };

  return {
    outputBuffer: resizedBuffer.buffer,
    height: resizedMetadata.height,
    width: resizedMetadata.width,
    ...formatDetails,
    size,
    isAnimated: animated,
  };
}

export async function processForFileServerUpload(
  inputBuffer: ArrayBufferLike,
  maxSidePx: number,
  maxSizeBytes: number
) {
  if (!inputBuffer?.byteLength) {
    throw new Error('processForFileServerUpload: inputBuffer is required');
  }
  const lossyFormats = ['jpeg', 'webp', 'avif'];
  const start = Date.now();
  const metadata = await metadataFromBuffer(inputBuffer, false);

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
    const size = metadataSizeIsSetOrThrow(metadata, 'processForFileServerUpload');
    logIfOn(
      `isLossyFormatButFits: returning buffer of size ${size} and WxH: ${metadata.width}x${metadata.height}`
    );

    return {
      format: metadata.format,
      outputBuffer: inputBuffer,
      size,
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

    const size = metadataSizeIsSetOrThrow(metadata, 'processForFileServerUpload');
    logIfOn(
      `not lossy format but fits, returning buffer of size ${size} and WxH: ${metadata.width}x${metadata.height}`
    );

    return {
      format: metadata.format,
      outputBuffer: inputBuffer,
      size,
      width: metadata.width,
      height: metadata.height, // this one is only the frame height already, no need for `metadataToFrameHeight`
      isAnimated: isAnimated(metadata),
    };
  }

  const base = await vipsFrom(inputBuffer, { animated });

  // Resize if needed
  if (metadata.width > maxSidePx || metadata.height > maxSidePx) {
    base.resize({
      width: maxSidePx,
      height: maxSidePx,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // if we can't get a picture with a quality of more than 30, consider it a failure and return null
  const qualityRange = [95, 85, 75, 55, 30] as const;
  for (const quality of qualityRange) {
    const pipeline = base.clone();

    switch (metadata.format) {
      case 'jpeg':
        pipeline.jpeg({ quality });
        break;
      case 'webp':
        pipeline.webp({ quality });
        break;
      default:
        throw new Error(`Unsupported format: ${metadata.format}`);
    }

    // eslint-disable-next-line no-await-in-loop
    const buffer = await pipeline.toBuffer(); // no timeout here for now

    if (buffer.length < maxSizeBytes) {
      // eslint-disable-next-line no-await-in-loop
      const outputMetadata = await metadataFromBuffer(buffer, false);

      if (!outputMetadata) {
        return null;
      }

      const size = metadataSizeIsSetOrThrow(outputMetadata, 'processForFileServerUpload');
      logIfOn(
        `[imageProcessorWorker] processForFileServerUpload: DONE quality ${quality} took ${
          Date.now() - start
        }ms for}`
      );
      logIfOn(
        `\t src${formattedMetadata({ width: metadata.width, height: metadata.height, format: metadata.format, size: inputBuffer.byteLength })} `
      );
      logIfOn(
        `\t dest${formattedMetadata({ width: outputMetadata.width, height: outputMetadata.height, format: metadata.format, size: buffer.buffer.byteLength })} `
      );

      return {
        format: outputMetadata.format,
        outputBuffer: buffer.buffer,
        size,
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
