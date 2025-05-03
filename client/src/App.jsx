import { useState } from 'react';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [downloading, setDownloading] = useState({
    status: false,
    type: '', // 'video', 'audio', or 'merge'
    progress: 0
  });
  const [downloadType, setDownloadType] = useState('video');
  const [selectedFormats, setSelectedFormats] = useState({
    video: null,
    audio: null
  });

  const handleDownload = async () => {
    if (!url) {
      setError('Please enter a YouTube URL');
      return;
    }

    setIsLoading(true);
    setError('');
    setVideoInfo(null);

    try {
      const response = await fetch(`http://localhost:5000/videoInfo?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setVideoInfo(data);
    } catch (err) {
      console.error('Fetch error:', err);
      setError(err.message || 'Failed to fetch video information');
    } finally {
      setIsLoading(false);
    }
  };

  const downloadFile = async (endpoint, type) => {
    try {
      const response = await fetch(`http://localhost:5000${endpoint}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const contentLength = +response.headers.get('Content-Length');
      let receivedLength = 0;
      let chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedLength += value.length;
        setDownloading(prev => ({
          ...prev,
          progress: Math.round((receivedLength / contentLength) * 100)
        }));
      }

      return new Blob(chunks, { type: type === 'video' ? 'video/mp4' : 'audio/mpeg' });
    } catch (err) {
      console.error('Download error:', err);
      throw err;
    }
  };

  const handleFormatSelect = (format, type) => {
    setSelectedFormats(prev => ({
      ...prev,
      [type]: format
    }));
  };

  const handleSeparateDownload = async (type) => {
    if (!url || downloading.status) return;

    const format = type === 'video' ? selectedFormats.video : selectedFormats.audio;
    if (!format) {
      setError(`Please select a ${type} format first`);
      return;
    }

    setDownloading({
      status: true,
      type: type,
      progress: 0
    });
    setError('');

    try {
      const endpoint = type === 'audio'
        ? `/download/audio?url=${encodeURIComponent(url)}&itag=${format.itag}`
        : `/download?url=${encodeURIComponent(url)}&itag=${format.itag}`;

      const blob = await downloadFile(endpoint, type);

      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${type}.${type === 'audio' ? 'mp3' : 'mp4'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

    } catch (err) {
      console.error('Download failed:', err);
      setError(`Download failed: ${err.message}`);
    } finally {
      setDownloading({
        status: false,
        type: '',
        progress: 0
      });
    }
  };

  const handleMergeDownload = async () => {
    if (!url || downloading.status || !selectedFormats.video || !selectedFormats.audio) {
      setError('Please select both video and audio formats first');
      return;
    }

    setDownloading({
      status: true,
      type: 'merge',
      progress: 0
    });
    setError('');

    let progressEventSource = null;

    try {
      // 1. Setup progress tracking for video download only
      const streamId = Math.random().toString(36).substring(7);
      progressEventSource = new EventSource(
        `http://localhost:5000/download/progress/${streamId}`
      );

      progressEventSource.onmessage = (e) => {
        const { type, data } = JSON.parse(e.data);
        if (type === 'progress') {
          console.log('Video Download Progress:', data);

          // Optional parsing of progress details
          const progressMatch = data.match(/\[download\]\s+([\d.]+)% of\s+([\d.]+)(\w+) at\s+([\d.]+)(\w+\/s) ETA (\d+:\d+)/);
          if (progressMatch) {
            const [, percent, size, sizeUnit, speed, speedUnit, eta] = progressMatch;
            console.log('Parsed Progress:', {
              percentage: parseFloat(percent),
              size: `${size} ${sizeUnit}`,
              speed: `${speed} ${speedUnit}`,
              eta
            });
          }
        }
        else if (type === 'error') {
          console.error('Download error:', data);
        }
      };

      // 2. Download video with progress tracking
      setDownloading(prev => ({ ...prev, progress: 30 }));
      const videoResponse = await fetch(
        `http://localhost:5000/download?url=${encodeURIComponent(url)}&itag=${selectedFormats.video.itag}&id=${streamId}`
      );

      if (!videoResponse.ok) throw new Error('Video download failed');
      const videoBlob = await videoResponse.blob();

      // 3. Download audio (without progress tracking)
      setDownloading(prev => ({ ...prev, progress: 60 }));
      const audioResponse = await fetch(
        `http://localhost:5000/download/audio?url=${encodeURIComponent(url)}&itag=${selectedFormats.audio.itag}`
      );
      if (!audioResponse.ok) throw new Error('Audio download failed');
      const audioBlob = await audioResponse.blob();

      // 4. Prepare FormData
      setDownloading(prev => ({ ...prev, progress: 70 }));
      const formData = new FormData();
      formData.append('video', videoBlob, 'video.mp4');
      formData.append('audio', audioBlob, 'audio.mp3');

      // 5. Merge files
      setDownloading(prev => ({ ...prev, progress: 80 }));
      const mergeResponse = await fetch('http://localhost:5000/merge', {
        method: 'POST',
        body: formData
      });

      const mergeResult = await mergeResponse.json();
      if (!mergeResult.success) {
        throw new Error(mergeResult.error || 'Merge failed');
      }

      // 6. Download merged file
      setDownloading(prev => ({ ...prev, progress: 90 }));
      const mergedResponse = await fetch(
        `http://localhost:5000/download-merged?filename=${mergeResult.filename}`
      );
      if (!mergedResponse.ok) throw new Error('Failed to download merged file');
      const mergedBlob = await mergedResponse.blob();

      // 7. Save merged file
      setDownloading(prev => ({ ...prev, progress: 100 }));
      const downloadUrl = window.URL.createObjectURL(mergedBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'merged_video.mp4';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

    } catch (err) {
      console.error('Merge process error:', err);
      setError(`Merge failed: ${err.message}`);
    } finally {
      if (progressEventSource) {
        progressEventSource.close();
      }
      setDownloading({
        status: false,
        type: '',
        progress: 0
      });
    }
  };

  const filteredFormats = (type) => {
    if (!videoInfo?.formats) return [];

    return videoInfo.formats.filter(format => {
      if (type === 'audio') {
        return format.type?.includes('audio');
      } else {
        return format.type?.includes('video') && !format.type?.includes('audio only');
      }
    });
  };

  return (
    <div className='h-screen w-screen flex justify-center items-center'>
      <div className='w-full md:w-1/2 text-center px-4'>
        <h1 className='text-4xl md:text-7xl font-bold'>YouTube Downloader</h1>
        <p className='text-gray-700 text-lg mb-8'>Download videos or audio from YouTube</p>

        <div className='w-full flex flex-col items-center space-y-4'>
          <input
            type="text"
            placeholder='Enter YouTube URL'
            className='border-2 border-gray-300 rounded-md p-2 w-full'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleDownload()}
          />

          <div className="flex gap-4">
            <button
              className={`px-4 py-2 rounded-md font-bold transition-colors ${downloadType === 'video'
                ? 'bg-yellow-400 text-black'
                : 'bg-gray-200 text-gray-700'
                }`}
              onClick={() => setDownloadType('video')}
            >
              Video
            </button>
            <button
              className={`px-4 py-2 rounded-md font-bold transition-colors ${downloadType === 'audio'
                ? 'bg-yellow-400 text-black'
                : 'bg-gray-200 text-gray-700'
                }`}
              onClick={() => setDownloadType('audio')}
            >
              Audio
            </button>
          </div>

          <button
            className='bg-yellow-400 hover:bg-yellow-500 font-bold text-black rounded-md px-8 py-2 transition-colors disabled:opacity-50'
            onClick={handleDownload}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Get Available Formats'}
          </button>

          {error && <p className="text-red-500">{error}</p>}

          {downloading.status && (
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full"
                style={{ width: `${downloading.progress}%` }}
              ></div>
              <p className="text-sm mt-1">
                {downloading.type === 'merge' ? 'Merging files...' : `Downloading ${downloading.type}...`}
                ({downloading.progress}%)
              </p>
            </div>
          )}

          {videoInfo && (
            <div className="w-full mt-6 text-left bg-gray-100 p-4 rounded-lg">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="md:w-1/3">
                  <img
                    src={videoInfo.thumbnail}
                    alt="Video thumbnail"
                    className="aspect-video w-full rounded-lg"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'https://via.placeholder.com/320x180?text=Thumbnail+Not+Available';
                    }}
                  />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold">{videoInfo.title || 'Untitled Video'}</h2>

                  {/* Video Formats Section */}
                  <div className="mt-4">
                    <h3 className="text-lg font-semibold">Video Formats:</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                      {filteredFormats('video').map((format, index) => (
                        <div key={`video-${index}`} className="flex items-center gap-2">
                          <button
                            className={`flex-1 bg-blue-500 hover:bg-blue-600 text-white rounded-md p-2 transition-colors text-sm ${selectedFormats.video?.itag === format.itag ? 'ring-2 ring-blue-700' : ''
                              }`}
                            onClick={() => handleFormatSelect(format, 'video')}
                            disabled={downloading.status}
                          >
                            {format.quality || 'Unknown'} ({format.type || 'Unknown'})
                          </button>
                          <button
                            className="bg-green-500 hover:bg-green-600 text-white rounded-md p-2 transition-colors text-sm"
                            onClick={() => handleSeparateDownload('video')}
                            disabled={downloading.status}
                          >
                            Download
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Audio Formats Section */}
                  <div className="mt-4">
                    <h3 className="text-lg font-semibold">Audio Formats:</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                      {filteredFormats('audio').map((format, index) => (
                        <div key={`audio-${index}`} className="flex items-center gap-2">
                          <button
                            className={`flex-1 bg-blue-500 hover:bg-blue-600 text-white rounded-md p-2 transition-colors text-sm ${selectedFormats.audio?.itag === format.itag ? 'ring-2 ring-blue-700' : ''
                              }`}
                            onClick={() => handleFormatSelect(format, 'audio')}
                            disabled={downloading.status}
                          >
                            {format.audioBitrate ? `${format.audioBitrate}kbps` : format.quality || 'Unknown'}
                          </button>
                          <button
                            className="bg-green-500 hover:bg-green-600 text-white rounded-md p-2 transition-colors text-sm"
                            onClick={() => handleSeparateDownload('audio')}
                            disabled={downloading.status}
                          >
                            Download
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Merge Button */}
                  {selectedFormats.video && selectedFormats.audio && (
                    <div className="mt-4">
                      <button
                        className="w-full bg-purple-500 hover:bg-purple-600 text-white rounded-md p-2 transition-colors font-bold"
                        onClick={handleMergeDownload}
                        disabled={downloading.status}
                      >
                        Download Merged Video+Audio (
                        {selectedFormats.video.quality || 'Unknown'} +
                        {selectedFormats.audio.audioBitrate ? `${selectedFormats.audio.audioBitrate}kbps` : 'Unknown'}
                        )
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;