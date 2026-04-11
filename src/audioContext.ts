import {
  AudioContext,
  decodeAudioData,
  type AudioBufferSourceNode,
  type GainNode,
  type AudioBuffer,
  type StreamerNode,
} from 'react-native-audio-api';

type AudioDestination = AudioContext['destination'];

export interface PlaybackAudioContext {
  readonly state: 'running' | 'suspended' | 'closed';
  readonly currentTime: number;
  readonly destination: AudioDestination;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  createStreamer(): StreamerNode | null;
  suspend(): boolean | Promise<boolean> | Promise<void>;
  resume(): boolean | Promise<boolean> | Promise<void>;
  close(): void | Promise<void>;
}

export interface PlaybackAudioApi {
  createContext(): PlaybackAudioContext;
  decode(url: string): Promise<AudioBuffer> | AudioBuffer;
}

export type {
  AudioBuffer,
  AudioBufferSourceNode,
  GainNode,
  StreamerNode,
};

export const playbackAudioApi: PlaybackAudioApi = {
  createContext: () => new AudioContext(),
  decode: (url) => decodeAudioData(url),
};
