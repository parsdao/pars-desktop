type WithIsAnimated = {
  isAnimated: boolean;
};

type WithSharpSize = { size: number };
type WithSharpWidth = { width: number };
type WithSharpHeight = { height: number };
type WithOutputBuffer = { outputBuffer: ArrayBufferLike };

type WithSupportedImageFormat<T extends 'jpeg' | 'png' | 'webp' | 'gif'> = {
  format: T;
  contentType: `image/${T}`;
};

type WithWebpFormat = WithSupportedImageFormat<'webp'>;
type WithGifFormat = WithSupportedImageFormat<'gif'>;

/**
 * The output of a always static output image.
 */
type StaticOutputType = WithOutputBuffer & WithSharpSize & WithSharpWidth & WithSharpHeight;

export type ProcessedAvatarDataType = NonNullable<
  Awaited<ReturnType<ImageProcessorWorkerActions['processAvatarData']>>
>;

export type ProcessedLinkPreviewThumbnailType = NonNullable<
  Awaited<ReturnType<ImageProcessorWorkerActions['processForLinkPreviewThumbnail']>>
>;

export interface IpcImageProcessorChannels {
  processForLinkPreviewThumbnail: {
    request: {
      buffer: ArrayBufferLike;
      maxSidePx: number;
    };
    response: {
      outputBuffer: ArrayBufferLike;
      height: number;
      width: number;
      format: 'webp';
      contentType: `image/webp`;
      size: number;
      isAnimated: false;
    };
  };
  processForInConversationThumbnail: {
    request: {
      buffer: ArrayBufferLike;
      maxSidePx: number;
    };
    response: {
      outputBuffer: ArrayBufferLike;
      height: number;
      width: number;
      format: 'webp';
      contentType: `image/webp`;
      size: number;
      isAnimated: false;
    };
  };
  testIntegrationFakeAvatar: {
    request: {
      maxSidePx: number;
      background: { r: number; g: number; b: number };
    };
    response: {
      outputBuffer: ArrayBufferLike;
      height: number;
      width: number;
      format: 'webp';
      contentType: `image/webp`;
      size: number;
      isAnimated: false;
    };
  };
  imageDimensions: {
    request: {
      buffer: ArrayBufferLike;
    };
    response: {
      height: number;
      width: number;
    };
  };
  /**
   * Process an avatar. Depending on if we want this to be reuploaded or not, we allow gif as a return format or not.
   * The reason is that when we plan for reupload, we don't **always** convert gif to webp, as we might want to keep it as gif.
   * We will try to convert an input gif to webp, but if it takes too long or the resulting file size is too big, we will just use the original gif.
   * When the change is not planned for reupload, we convert everything to a webp.
   * This function will generate a mainAvatar, and a fallbackAvatar if needed.
   *
   * The mainAvatar can be animated or not.
   *  - If animated it is an animated gif or webp,
   *  - If not, it is a static webp (always).
   * The fallbackAvatar, if set, is always a static webp.
   *
   * planForReupload must be true for
   *  - our own avatar (changed by the current user, locally or not)
   *  - our own avatar (automatic reupload)
   *  - (later: for a groupv2 avatar: locally or not and on reupload, even if we are not an admin (as we might become one)
   */
  processAvatarData: {
    request: { buffer: ArrayBufferLike; planForReupload: boolean; remoteChange: boolean };
    response: {
      mainAvatarDetails: StaticOutputType &
        WithIsAnimated &
        WithSupportedImageFormat<'gif' | 'webp'>;
      avatarFallback: (StaticOutputType & WithWebpFormat) | null;
    } | null;
  };
  /**
   * Process an image to get something that we can upload to the file server.
   * This is only used for attachments, as avatars have a lot tighter requirements.
   *
   * If
   *  - not an image, or
   *  - not one we can process (i.e enforced lossless),
   *  - or we cannot get an image small enough after dropping the quality
   * null will be returned.
   * The caller should always check if the requirements are met before trying to upload.
   *
   * Note: the lossy formats are jpeg, webp and avif.
   * Anything else that is an image supported by sharp will only be scaled down to maxSidePx.
   * Anything else not an image supported by sharp will return null.
   *
   * To make it clear,
   * - if the image is **lossy** and already fits the requirements, we return it as is.
   * - if the image is **lossless**:
   *  - if it fits the requirements, we return it as is (not even scaled down, as we'd need a loader in the staged attachments list to display the loading state)
   *  - if it does not fit the requirements, we return null
   * - if the image is **lossy** and doesn't fit:
   *  - we first scale it down the maxSize, and then iterate over the quality to get something that fits the maxSizeBytes.
   *  - if we cannot get a file under maxSizeBytes, we return null
   *
   *
   * @param input: the image data to process
   * @param maxSidePx: we cap an image to this size. If the image is larger, it will be scaled down to this before we start dropping the quality.
   * @param maxSizeBytes: loop dropping the quality until we get a file under this size. (binary approach)
   */
  processForFileServerUpload: {
    request: { buffer: ArrayBufferLike; maxSidePx: number; maxSizeBytes: number };
    response: (MaybeAnimatedOutputType & WithSupportedImageFormat) | null;
  };
}

export type IpcChannelMethods<T> = {
  [K in keyof T]: T[K] extends { request: infer Req; response: infer Res }
    ? (request: Req) => Promise<Res>
    : never;
};

export type IpcImageProcessorChannelName = keyof IpcImageProcessorChannels;

export type IpcImageProcessorRequest<T extends IpcImageProcessorChannelName> =
  IpcImageProcessorChannels[T]['request'];
export type IpcImageProcessorResponse<T extends IpcImageProcessorChannelName> =
  IpcImageProcessorChannels[T]['response'];
