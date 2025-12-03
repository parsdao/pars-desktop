import { ipcRenderer } from 'electron';
import type { IpcChannelMethods, IpcImageProcessorChannels } from '../types/ipc/imageProcessorIpc';

export const ImageProcessor: IpcChannelMethods<IpcImageProcessorChannels> = {
  async processForInConversationThumbnail(
    args: IpcImageProcessorChannels['processForInConversationThumbnail']['request']
  ): Promise<IpcImageProcessorChannels['processForInConversationThumbnail']['response']> {
    return ipcRenderer.invoke('processForInConversationThumbnail', args);
  },

  async processForLinkPreviewThumbnail(
    args: IpcImageProcessorChannels['processForLinkPreviewThumbnail']['request']
  ): Promise<IpcImageProcessorChannels['processForLinkPreviewThumbnail']['response']> {
    return ipcRenderer.invoke('processForLinkPreviewThumbnail', args);
  },

  async testIntegrationFakeAvatar(
    args: IpcImageProcessorChannels['testIntegrationFakeAvatar']['request']
  ): Promise<IpcImageProcessorChannels['testIntegrationFakeAvatar']['response']> {
    return ipcRenderer.invoke('testIntegrationFakeAvatar', args);
  },

  async imageDimensions(
    args: IpcImageProcessorChannels['imageDimensions']['request']
  ): Promise<IpcImageProcessorChannels['imageDimensions']['response']> {
    return ipcRenderer.invoke('imageDimensions', args);
  },

  async processAvatarData(
    args: IpcImageProcessorChannels['processAvatarData']['request']
  ): Promise<IpcImageProcessorChannels['processAvatarData']['response']> {
    return ipcRenderer.invoke('processAvatarData', args);
  },

  async processForFileServerUpload(
    args: IpcImageProcessorChannels['processForFileServerUpload']['request']
  ): Promise<IpcImageProcessorChannels['processForFileServerUpload']['response']> {
    return ipcRenderer.invoke('processForFileServerUpload', args);
  },
};
