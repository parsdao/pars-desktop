export type VipsMetadata = {
  width: number;
  height: number;
  bands: number;
  format: VipsFormat;
  space?: string;
  pages?: number;
  pageHeight?: number;
  hasAlpha?: boolean;
  orientation?: number;
  size?: number;
};

export type VipsExtension = `.${VipsFormat}`;

export type VipsFormat =
  | 'jpg'
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'tiff'
  | 'tif'
  | 'avif'
  | 'heif'
  | 'jp2'
  | 'jxl'
  | 'pdf'
  | 'svg'
  | 'v'; // native vips format
