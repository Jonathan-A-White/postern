// src/cockpit/PosternPictureViewer.tsx — pwa-kit's picture viewer (pinch, drag, double tap, Close, Escape, Save) with
// Postern's Save: a nameless picture is saved as postern-<day>.<ext>. The Conversation and the Composer draw this one.
import { PictureViewer, savePicture, type ShownPicture } from 'pwa-kit/picture-viewer';

const savePosternPicture = (src: string, name: string | undefined, type: string | undefined) => savePicture(src, name, type, 'postern');

export function PosternPictureViewer({ picture, onClose }: { picture: ShownPicture; onClose: () => void }) {
  return <PictureViewer {...picture} onClose={onClose} save={savePosternPicture} />;
}
