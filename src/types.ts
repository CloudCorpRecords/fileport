/**
 * fileport types.
 */

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  created: string;
  modified: string;
  accessed: string;
  isDirectory: boolean;
  isFile: boolean;
  type: string;
  permissions: string;
}

export interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export interface SizedEntry {
  name: string;
  type: "file" | "directory";
  size: number;
}

export interface EditSpec {
  oldText: string;
  newText: string;
}

export interface MediaResult {
  kind: "image" | "audio" | "blob";
  mimeType: string;
  data: string; // base64
}
