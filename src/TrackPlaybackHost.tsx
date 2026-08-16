import React, { useEffect, useRef, useState } from 'react';

import { Audio, type AudioTagHandle, AudioContext } from 'react-native-audio-api';

import { playbackEngine } from './PlaybackEngine';
import { Event, Track } from './types';
import TrackPlayer from './TrackPlayer';

export function TrackPlaybackHost() {
  const [track, setTrack] = useState<Track | null>(() => TrackPlayer.getActiveTrack() ?? null)
  const contextRef = useRef<AudioContext | null>(null);

  if (!contextRef.current) {
    contextRef.current = new AudioContext({
      sampleRate: 44100
    })
  }

  useEffect(() => {
    const subscription = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (t) => { setTrack(t.track) });

    return () => subscription.remove();
  }, [])

  useEffect(() => {
    return () => {
      playbackEngine.attach(null);

      contextRef.current?.close().catch((err) => console.log(err));
      contextRef.current = null;
    }
  }, [])

  return (
    <Audio
      context={contextRef.current}
      ref={(handle: AudioTagHandle | null) => playbackEngine.attach(handle)}
      source={track?.url ?? ''}
      onPositionChange={(position) => playbackEngine.setPosition(position)}
      onPause={() => playbackEngine.handlePaused()}
      onPlay={() => playbackEngine.handlePlaying()}
      onEnded={() => playbackEngine.handleEnded()}
      onError={(error) => playbackEngine.handleOnError(error)}
      autoPlay={true}
    />
  );
}
