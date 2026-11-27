import { api, errorMessage } from "@/utils/api";

export interface MovableDocumentFile {
  name: string;
  folderName?: string | null;
}

export interface DocumentActionResult {
  success: boolean;
  error?: string | null;
  message?: string | null;
}

const Document = {
  createFolder: async (name: string): Promise<DocumentActionResult> => {
    try {
      return await api.post<DocumentActionResult>("/document/create-folder", {
        name,
      });
    } catch (e) {
      console.error(e);
      return { success: false, error: errorMessage(e) };
    }
  },

  moveToFolder: async (
    files: MovableDocumentFile[],
    folderName: string
  ): Promise<DocumentActionResult> => {
    const data = {
      files: files.map((file) => ({
        from: file.folderName ? `${file.folderName}/${file.name}` : file.name,
        to: `${folderName}/${file.name}`,
      })),
    };

    try {
      return await api.post<DocumentActionResult>("/document/move-files", data);
    } catch (e) {
      console.error(e);
      return { success: false, error: errorMessage(e) };
    }
  },
};

export default Document;
