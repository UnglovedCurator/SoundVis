import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Slider, Switch, Button, Typography, Box } from '@mui/material';

const SoundInterferenceVisualizer = () => {
  const [frequency, setFrequency] = useState(440);
  const [frequencySpan, setFrequencySpan] = useState(100);
  const [speakers, setSpeakers] = useState([
    { x: 25, y: 33, inverted: false },
    { x: 25, y: 67, inverted: false },
  ]);
  const [observer, setObserver] = useState({ x: 75, y: 50 });
  const [scale, setScale] = useState(5); // 5 pixels per meter
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioBufferRef = useRef(null);
  const audioSourceRef = useRef(null);
  const gainNodesRef = useRef([]);
  const delayNodesRef = useRef([]);
  const bandpassFilterRef = useRef(null);
  const fileRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const canvasWidth = 800;
  const canvasHeight = 600;

  const handleFrequencyChange = (value) => {
    setFrequency(value[0]);
    updateBandpassFilter();
  };

  const handleFrequencySpanChange = (value) => {
    setFrequencySpan(value[0]);
    updateBandpassFilter();
  };

  const handleDrag = (index, newX, newY) => {
    if (index === 'observer') {
      setObserver({ x: newX, y: newY });
    } else {
      setSpeakers(prevSpeakers => {
        const newSpeakers = [...prevSpeakers];
        newSpeakers[index] = { ...newSpeakers[index], x: newX, y: newY };
        return newSpeakers;
      });
    }
  };

  const handlePhaseInvert = (index) => {
    setSpeakers(prevSpeakers => {
      const newSpeakers = [...prevSpeakers];
      newSpeakers[index] = { ...newSpeakers[index], inverted: !newSpeakers[index].inverted };
      return newSpeakers;
    });
  };

  const calculateDistance = (point1, point2) => {
    const dx = (point2.x - point1.x) * canvasWidth / 100 / scale;
    const dy = (point2.y - point1.y) * canvasHeight / 100 / scale;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    setScale(prevScale => {
      const newScale = prevScale + event.deltaY * -0.01;
      return Math.min(Math.max(newScale, 0.1), 20);
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const drawInterference = () => {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      const imageData = ctx.createImageData(canvasWidth, canvasHeight);
      const data = imageData.data;

      for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
          let totalAmplitude = 0;
          
          speakers.forEach(speaker => {
            const dx = (x - speaker.x * canvasWidth / 100) / scale;
            const dy = (y - speaker.y * canvasHeight / 100) / scale;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const phase = distance / (340 / frequency) * Math.PI * 2;
            const amplitude = Math.sin(phase) / Math.max(1, distance);
            totalAmplitude += speaker.inverted ? -amplitude : amplitude;
          });

          const intensity = (totalAmplitude + 1) / 2;
          const index = (y * canvasWidth + x) * 4;

          data[index] = 0;
          data[index + 1] = intensity * 255;
          data[index + 2] = 0;
          data[index + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Draw speakers and observer
      const drawPoint = (x, y, color, label) => {
        ctx.beginPath();
        ctx.arc(x * canvasWidth / 100, y * canvasHeight / 100, 5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.fillText(label, x * canvasWidth / 100 + 10, y * canvasHeight / 100 - 10);
      };

      speakers.forEach((speaker, index) => {
        drawPoint(speaker.x, speaker.y, 'red', `Speaker ${index + 1}`);
      });
      drawPoint(observer.x, observer.y, 'blue', 'Observer');

      // Draw measurements
      ctx.strokeStyle = 'white';
      ctx.setLineDash([5, 5]);
      
      // Distance between speakers
      const speakerDistance = calculateDistance(speakers[0], speakers[1]);
      ctx.beginPath();
      ctx.moveTo(speakers[0].x * canvasWidth / 100, speakers[0].y * canvasHeight / 100);
      ctx.lineTo(speakers[1].x * canvasWidth / 100, speakers[1].y * canvasHeight / 100);
      ctx.stroke();
      ctx.fillStyle = 'white';
      ctx.fillText(`${speakerDistance.toFixed(2)}m`, (speakers[0].x + speakers[1].x) / 2 * canvasWidth / 100, (speakers[0].y + speakers[1].y) / 2 * canvasHeight / 100);

      // Middle point between speakers
      const middlePoint = {
        x: (speakers[0].x + speakers[1].x) / 2,
        y: (speakers[0].y + speakers[1].y) / 2
      };

      // Distance from observer to middle point
      const observerToMiddleDistance = calculateDistance(observer, middlePoint);
      ctx.beginPath();
      ctx.moveTo(middlePoint.x * canvasWidth / 100, middlePoint.y * canvasHeight / 100);
      ctx.lineTo(observer.x * canvasWidth / 100, observer.y * canvasHeight / 100);
      ctx.stroke();
      ctx.fillStyle = 'white';
      ctx.fillText(`${observerToMiddleDistance.toFixed(2)}m`, (middlePoint.x + observer.x) / 2 * canvasWidth / 100, (middlePoint.y + observer.y) / 2 * canvasHeight / 100);
    };

    drawInterference();
  }, [frequency, speakers, observer, scale]);

  useEffect(() => {
    if (isPlaying && audioContextRef.current && audioBufferRef.current) {
      updateAudio();
    }
  }, [observer, speakers, isPlaying]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      fileRef.current = file;
      loadAudioFile();
    }
  };

  const loadAudioFile = () => {
    if (!fileRef.current) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        audioBufferRef.current = await audioContextRef.current.decodeAudioData(arrayBuffer);
      } catch (error) {
        console.error('Error decoding audio data:', error);
      }
    };
    
    reader.readAsArrayBuffer(fileRef.current);
  };

  const toggleAudio = () => {
    if (isPlaying) {
      stopAudio();
    } else {
      playAudio();
    }
  };

  const playAudio = () => {
    if (!audioContextRef.current || !audioBufferRef.current) {
      console.log('Audio not loaded');
      return;
    }

    audioSourceRef.current = audioContextRef.current.createBufferSource();
    audioSourceRef.current.buffer = audioBufferRef.current;

    bandpassFilterRef.current = audioContextRef.current.createBiquadFilter();
    bandpassFilterRef.current.type = 'bandpass';
    updateBandpassFilter();

    gainNodesRef.current = speakers.map(() => audioContextRef.current.createGain());
    delayNodesRef.current = speakers.map(() => audioContextRef.current.createDelay(1));

    audioSourceRef.current.connect(bandpassFilterRef.current);

    speakers.forEach((_, index) => {
      bandpassFilterRef.current.connect(delayNodesRef.current[index]);
      delayNodesRef.current[index].connect(gainNodesRef.current[index]);
      gainNodesRef.current[index].connect(audioContextRef.current.destination);
    });

    audioSourceRef.current.start(0);
    setIsPlaying(true);
    updateAudio();
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const updateBandpassFilter = () => {
    if (bandpassFilterRef.current) {
      bandpassFilterRef.current.frequency.setValueAtTime(frequency, audioContextRef.current.currentTime);
      bandpassFilterRef.current.Q.setValueAtTime(frequency / frequencySpan, audioContextRef.current.currentTime);
    }
  };

  const updateAudio = () => {
    if (!isPlaying || !gainNodesRef.current.length) return;

    const maxDistance = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight) / scale;

    speakers.forEach((speaker, index) => {
      const distance = calculateDistance(observer, speaker);
      const delay = distance / 343; // Speed of sound is approximately 343 m/s
      const attenuation = 1 / Math.max(0.1, distance);
      
      const delayNode = delayNodesRef.current[index];
      const gainNode = gainNodesRef.current[index];

      delayNode.delayTime.setValueAtTime(delay, audioContextRef.current.currentTime);
      gainNode.gain.setValueAtTime(attenuation * (speaker.inverted ? -1 : 1) * 7, audioContextRef.current.currentTime); // Increased volume multiplier from 5 to 7
    });
  };

  return (
    <Box className="flex flex-col items-center space-y-6 p-8 bg-gray-100 rounded-lg shadow-md">
      <Typography variant="h4" className="font-bold text-gray-800">Sound Interference Visualizer</Typography>
      <Box className="w-full max-w-md space-y-4">
        <Box>
          <Typography variant="body2" className="text-gray-700 mb-1">Frequency</Typography>
          <Slider
            value={frequency}
            onChange={(_, value) => handleFrequencyChange([value])}
            min={20}
            max={2000}
            step={1}
          />
          <Typography variant="body2" className="text-center mt-2 text-gray-600">{frequency} Hz</Typography>
        </Box>
        <Box>
          <Typography variant="body2" className="text-gray-700 mb-1">Frequency Span</Typography>
          <Slider
            value={frequencySpan}
            onChange={(_, value) => handleFrequencySpanChange([value])}
            min={10}
            max={500}
            step={10}
          />
          <Typography variant="body2" className="text-center mt-2 text-gray-600">{frequencySpan} Hz</Typography>
        </Box>
      </Box>
      <Box className="flex space-x-8">
        {speakers.map((speaker, index) => (
          <Box key={index} className="flex items-center">
            <Switch
              checked={speaker.inverted}
              onChange={() => handlePhaseInvert(index)}
            />
            <Typography variant="body2" className="ml-2 text-gray-700">Invert Speaker {index + 1}</Typography>
          </Box>
        ))}
      </Box>
      <Box className="relative">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="border border-gray-300 rounded-lg shadow-inner"
          onMouseDown={(e) => {
            const rect = e.target.getBoundingClientRect();
            const x = (e.clientX - rect.left) / canvasWidth * 100;
            const y = (e.clientY - rect.top) / canvasHeight * 100;
            const clickedIndex = [...speakers, observer].findIndex(point => 
              Math.abs(point.x - x) < 5 && Math.abs(point.y - y) < 5
            );
            if (clickedIndex !== -1) {
              const handleMouseMove = (moveEvent) => {
                const newX = (moveEvent.clientX - rect.left) / canvasWidth * 100;
                const newY = (moveEvent.clientY - rect.top) / canvasHeight * 100;
                handleDrag(clickedIndex === 2 ? 'observer' : clickedIndex, newX, newY);
              };
              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };
              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }
          }}
        />
        <Typography variant="caption" className="absolute bottom-2 right-2 text-gray-500">Use the scroll wheel to zoom in/out</Typography>
      </Box>
      <Box className="flex flex-col items-center space-y-4">
        <input type="file" accept="audio/*" onChange={handleFileUpload} className="text-sm text-gray-700" />
        <Button 
          variant="contained" 
          onClick={toggleAudio} 
          className="px-6 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors"
        >
          {isPlaying ? 'Stop Audio' : 'Play Audio'}
        </Button>
      </Box>
    </Box>
  );
};

export default SoundInterferenceVisualizer;
