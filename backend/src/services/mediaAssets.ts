import { rowToCamel } from "../utils/case";
import { adminPreviewUrl, isProtectedRef } from "./signedUrls";
import type { Visibility } from "./mediaStorage";

export interface MediaAsset {
  id: number;
  filename: string;
  originalName: string;
  url: string;
  mime: string;
  kind: string;
  sizeBytes: number;
  title: string;
  folder: string;
  createdAt: string;
}

/**
 * What the library shows: the row, which directory it is in, and an address the
 * admin screens can point an <img>, <video> or <audio> at.
 *
 * `url` is a storage reference, and for a protected file it is not a URL at all
 * -- `protected:abc.mp4` in a src attribute draws an empty box, which is how a
 * video Yvette uploaded turns out to be unplayable on the one screen where she
 * could have caught it. `previewUrl` is the playable form: a signed link for a
 * protected file, the same path for a public one. It is minted here so a grid of
 * twelve videos costs one request rather than thirteen.
 *
 * Lives beside the storage rules rather than in the route, because both the
 * single-request upload and the resumable one answer with this shape and a
 * screen cannot tell which path a file arrived by.
 */
export type MediaAssetJson = MediaAsset & { visibility: Visibility; previewUrl: string };

export function toMediaJson(row: Record<string, unknown>, adminUserId: number): MediaAssetJson {
  const asset = rowToCamel<MediaAsset>(row);
  const isProtected = isProtectedRef(asset.url);
  return {
    ...asset,
    visibility: isProtected ? "protected" : "public",
    previewUrl: isProtected
      ? adminPreviewUrl({ assetId: asset.id, adminUserId }).url
      : asset.url,
  };
}
