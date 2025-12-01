/* eslint-disable no-console */
// app/services/imageProcessor.worker.ts
import { parentPort, workerData } from 'worker_threads';
import Vips from 'wasm-vips';

let vips: any = null;
let initPromise: Promise<any> | null = null;

async function initVips() {
  if (vips) {
    return vips;
  }

  if (!initPromise) {
    // eslint-disable-next-line more/no-then
    initPromise = Vips({}).then(v => {
      vips = v;
      console.log(`Worker ${workerData.workerId} initialized vips`);
      return v;
    });
  }

  return initPromise;
}

async function processImageThumbnail(data: {
  buffer: ArrayBuffer;
  options: {
    maxSidePx: number;
    quality?: number;
    withoutEnlargement?: boolean;
  };
}) {
  const vipsLib = await initVips();
  const { buffer, options } = data;

  const image: Vips.Image = vipsLib.Image.newFromBuffer(new Uint8Array(buffer));

  // Check if we need to resize
  if (
    options.withoutEnlargement &&
    image.width <= options.maxSidePx &&
    image.height <= options.maxSidePx
  ) {
    // Just convert to WebP
    const webpBuffer = image.writeToBuffer('.webp', {
      Q: options.quality ?? 80,
    });

    return {
      buffer: webpBuffer.buffer,
      width: image.width,
      height: image.height,
      size: webpBuffer.byteLength,
    };
  }

  // Resize
  const resized = image.thumbnailImage(options.maxSidePx, {
    height: options.maxSidePx,
    size: 'both',
    crop: 'centre',
  });

  const webpBuffer = resized.writeToBuffer('.webp', {
    Q: options.quality ?? 80,
  });

  return {
    buffer: webpBuffer.buffer,
    width: resized.width,
    height: resized.height,
    size: webpBuffer.byteLength,
  };
}

async function getImageMetadata(data: { buffer: ArrayBuffer }) {
  const vipsLib = await initVips();
  const image = vipsLib.Image.newFromBuffer(new Uint8Array(data.buffer));

  return {
    width: image.width,
    height: image.height,
    bands: image.bands,
    format: image.format,
    pages: image.get('n-pages') || 1,
    hasAlpha: image.hasAlpha(),
  };
}

// Message handler
// eslint-disable-next-line @typescript-eslint/no-misused-promises
parentPort?.on('message', async (message: any) => {
  const { id, operation, data } = message;

  try {
    let result;

    switch (operation) {
      case 'thumbnail':
        result = await processImageThumbnail(data);
        break;

      case 'metadata':
        result = await getImageMetadata(data);
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
});

// Initialization
console.log(`Worker ${workerData.workerId} started`);

// Pre-initialize vips for faster first request
initVips().catch(err => {
  console.error(`Worker ${workerData.workerId} failed to init vips:`, err);
});
