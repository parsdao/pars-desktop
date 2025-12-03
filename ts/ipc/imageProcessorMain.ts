import { ipcMain } from 'electron';
import { ImageWorkerPool } from '../services/ImageWorkerPool';

let imageWorkerPool: ImageWorkerPool | null = null;

export const ImageProcessorMain = {
  onReady: () => {
    if (imageWorkerPool) {
      return;
    }

    imageWorkerPool = new ImageWorkerPool({
      poolSize: 1,
    });

    ipcMain.handle('processForLinkPreviewThumbnail', async (_event, request) => {
      return imageWorkerPool?.processForLinkPreviewThumbnail(request);
    });

    ipcMain.handle('processForInConversationThumbnail', async (_event, request) => {
      return imageWorkerPool?.processForInConversationThumbnail(request);
    });

    ipcMain.handle('testIntegrationFakeAvatar', async (_event, request) => {
      return imageWorkerPool?.testIntegrationFakeAvatar(request);
    });

    ipcMain.handle('imageDimensions', async (_event, request) => {
      return imageWorkerPool?.imageDimensions(request);
    });

    ipcMain.handle('processForFileServerUpload', async (_event, request) => {
      return imageWorkerPool?.processForFileServerUpload(request);
    });

    ipcMain.handle('processAvatarData', async (_event, request) => {
      return imageWorkerPool?.processAvatarData(request);
    });
  },

  onShutDown: async () => {
    if (!imageWorkerPool) {
      return;
    }
    await imageWorkerPool.shutdown();
    imageWorkerPool = null;
  },
};
