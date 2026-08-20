import type { FileStructure } from '@/types/file-system.types';

type UploadedFileType = 'image' | 'pdf' | 'xlsx';

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i;

const checkMimeType = (file: File, mimeType: string | string[], extension?: string): boolean => {
  const types = Array.isArray(mimeType) ? mimeType : [mimeType];
  const lowerName = file.name?.toLowerCase();

  const mimeMatches = types.some((type) =>
    type.endsWith('/*') ? file.type?.startsWith(type.slice(0, -1)) : file.type === type,
  );

  const extensionMatches = extension && lowerName ? lowerName.endsWith(extension) : false;

  return mimeMatches || extensionMatches;
};

const hasFileExtension = (file: FileStructure | null, extensions: string[]): boolean => {
  if (!file || file.type !== 'file') return false;
  const fileName = file.path.split('/').pop()?.toLowerCase() || '';
  return extensions.some((ext) => fileName.endsWith(ext));
};

const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
  markdown: ['.md', '.markdown'],
  csv: ['.csv'],
  xlsx: ['.xlsx', '.xls'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'],
  html: ['.html', '.htm'],
  powerpoint: ['.ppt', '.pptx'],
  pdf: ['.pdf'],
};

// Must match backend ALLOWED_IMAGE_TYPES (image/jpeg, image/png, image/gif, image/webp)
export const isUploadedImageFile = (file: File): boolean =>
  checkMimeType(file, ['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export const isUploadedPdfFile = (file: File): boolean =>
  checkMimeType(file, 'application/pdf', '.pdf');

export const isUploadedXlsxFile = (file: File): boolean =>
  checkMimeType(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx');

export const isSupportedUploadedFile = (file: File): boolean =>
  isUploadedImageFile(file) || isUploadedPdfFile(file) || isUploadedXlsxFile(file);

export const isRenameFileType = (type?: string) =>
  type === 'rename-pure' || type === 'rename-changed';

export const isMarkdownFile = (file: FileStructure | null): boolean =>
  hasFileExtension(file, FILE_TYPE_EXTENSIONS.markdown);

export const isCsvFile = (file: FileStructure | null): boolean =>
  hasFileExtension(file, FILE_TYPE_EXTENSIONS.csv);

export const isXlsxFile = (file: FileStructure | null): boolean =>
  hasFileExtension(file, FILE_TYPE_EXTENSIONS.xlsx);

export const isImageFile = (file: FileStructure | null): boolean =>
  hasFileExtension(file, FILE_TYPE_EXTENSIONS.image);

export const isHtmlFile = (file: FileStructure | null): boolean =>
  hasFileExtension(file, FILE_TYPE_EXTENSIONS.html);

export const isPowerPointFile = (file: FileStructure | null): boolean =>
  hasFileExtension(file, FILE_TYPE_EXTENSIONS.powerpoint);

export const isPdfFile = (file: FileStructure | null): boolean =>
  hasFileExtension(file, FILE_TYPE_EXTENSIONS.pdf);

export const isImageUrl = (url: string): boolean => {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
  return imageExtensions.some((ext) => url.toLowerCase().endsWith(ext));
};

export const isPreviewableFile = (file: FileStructure | null): boolean => {
  return (
    isMarkdownFile(file) ||
    isCsvFile(file) ||
    isXlsxFile(file) ||
    isImageFile(file) ||
    isHtmlFile(file) ||
    isPowerPointFile(file) ||
    isPdfFile(file)
  );
};

export const detectFileType = (filename: string, mimeType?: string): UploadedFileType => {
  const lowerFilename = filename?.toLowerCase() || '';
  const lowerMimeType = mimeType?.toLowerCase() || '';

  if (lowerMimeType === 'application/pdf' || lowerFilename.endsWith('.pdf')) {
    return 'pdf';
  }

  if (lowerMimeType.startsWith('image/') || IMAGE_EXT_RE.test(lowerFilename)) {
    return 'image';
  }

  if (
    lowerMimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    lowerMimeType === 'application/vnd.ms-excel' ||
    lowerFilename.endsWith('.xlsx') ||
    lowerFilename.endsWith('.xls')
  ) {
    return 'xlsx';
  }

  throw new Error(`Unsupported file type: ${filename}`);
};
