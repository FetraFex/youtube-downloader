import { useState } from 'react';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);

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
      const data = await response.json();
      
      if (response.ok) {
        setVideoInfo(data);
      } else {
        setError(data.error || 'Failed to fetch video information');
      }
    } catch (err) {
      setError('Failed to connect to the server');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormatDownload = (itag) => {
    // This will trigger the browser's download
    window.open(`http://localhost:5000/download?url=${encodeURIComponent(url)}&itag=${itag}`, '_blank');
  };

  return (
    <div className='h-screen w-screen flex justify-center items-center'>
      <div className='w-full md:w-1/2 text-center px-4'>
        <h1 className='text-4xl md:text-7xl font-bold'>YouTube Video Downloader</h1>
        <p className='text-gray-700 text-lg mb-8'>Easily download your favorite videos to watch offline</p>
        
        <div className='w-full flex flex-col items-center space-y-4'>
          <input 
            type="text" 
            placeholder='Enter YouTube URL' 
            className='border-2 border-gray-300 rounded-md p-2 w-full' 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          
          <button 
            className='bg-yellow-400 hover:bg-yellow-500 font-bold text-black rounded-md px-8 py-2 transition-colors disabled:opacity-50'
            onClick={handleDownload}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Get Video Info'}
          </button>
          
          {error && <p className="text-red-500">{error}</p>}
          
          {videoInfo && (
            <div className="w-full mt-6 text-left bg-gray-100 p-4 rounded-lg">
              <div className="flex flex-col md:flex-row gap-4">
                <img 
                  src={videoInfo.thumbnail} 
                  alt="Video thumbnail" 
                  className="w-full md:w-1/3 rounded-lg"
                />
                <div className="flex-1">
                  <h2 className="text-xl font-bold">{videoInfo.title}</h2>
                  <h3 className="text-lg font-semibold mt-4">Available Formats:</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                    {videoInfo.formats.map((format, index) => (
                      <button 
                        key={index}
                        className="bg-blue-500 hover:bg-blue-600 text-white rounded-md p-2 transition-colors text-sm"
                        onClick={() => handleFormatDownload(format.itag)}
                      >
                        Download {format.quality} ({format.type})
                      </button>
                    ))}
                  </div>
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