export type ImageProcessorValidFormat = 'gif' | 'jpeg' | 'jpg' | 'png' | 'webp';
export type ImageProcessorContentType = `image/${ImageProcessorValidFormat}`;

export type UnknownFormat = 'unknown';

export type VipsMetadata = {
  width: number;
  height: number;
  format: ImageProcessorValidFormat | UnknownFormat;
  contentType: ImageProcessorContentType | UnknownFormat;
  pages?: number;
  size?: number;
};

export type VipsExtension = `.${ImageProcessorValidFormat}`;
