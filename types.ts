
export interface TidePrediction {
  t: string; // Time
  v: string; // Value
  type?: 'H' | 'L'; // High or Low tide
}

export interface NOAAStation {
  id: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
}

export interface TideEvent {
  time: Date;
  height: number;
  isPeak: boolean;
  type?: 'H' | 'L';
}

export interface DailyTideData {
  date: Date;
  events: TideEvent[];
  maxHeight: number;
  minHeight: number;
  meetsThreshold: boolean;
}
