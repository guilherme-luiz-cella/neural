import { useState, useEffect } from 'react';

interface Props {
  fileId: string;
  fileName: string;
  fileType: string | null;
}

export const MediaViewer = ({ fileId, fileName, fileType }: Props) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let objectUrl: string | null = null;
    const token = localStorage.getItem('access_token');
    fetch(`${import.meta.env.VITE_API_URL}/files/${fileId}/media`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load media');
        return r.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setError('Failed to load media file.'));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Loading…
      </div>
    );
  }

  const isImage = fileType?.startsWith('image/');
  const isVideo = fileType?.startsWith('video/');
  const isAudio = fileType?.startsWith('audio/');

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">
      <div className="px-4 py-1.5 border-b border-gray-800 bg-gray-900 shrink-0">
        <span className="text-xs text-gray-500">{fileName}</span>
        <span className="text-xs text-gray-700 ml-2">{fileType}</span>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-auto p-4">
        {isImage && (
          <img
            src={url}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        )}
        {isVideo && (
          <video
            src={url}
            controls
            className="max-w-full max-h-full rounded-lg shadow-2xl"
          />
        )}
        {isAudio && (
          <div className="flex flex-col items-center gap-4">
            <div className="text-6xl">🎵</div>
            <p className="text-gray-400 text-sm">{fileName}</p>
            <audio src={url} controls className="w-80" />
          </div>
        )}
        {!isImage && !isVideo && !isAudio && (
          <p className="text-gray-600 text-sm">Unsupported media type: {fileType}</p>
        )}
      </div>
    </div>
  );
};
