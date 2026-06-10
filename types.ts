
export enum UserRole {
  RUNNER = 'RUNNER',
  ORDERER = 'ORDERER',
  ADMIN = 'ADMIN'
}

export interface Order {
  id: string;
  userName: string;
  userEmail: string;
  itemDescription: string;
  cibusCode: string;
  floor: string;
  timestamp: number;
}

export interface WaitingOrder {
  id: string;
  userName: string;
  userEmail: string;
  destination: string;
  itemDescription: string;
  floor: string;
  timestamp: number;
}

export interface FoodRun {
  id: string;
  runnerName: string;
  runnerEmail: string;
  runnerId: string;
  destination: string;
  departureTime: number; 
  minutesUntilDeparture: number;
  maxOrders: number;
  orders: Order[]; // This might remain empty in the main doc
  orderCount: number;
  status: 'active' | 'departed' | 'arrived' | 'cancelled';
  arrivalLocation?: string;
  arrivalTime?: number;
  createdAt: any;
}

export interface UserNotification {
  id: string;
  targetEmail: string; // Added to identify recipient in shared state
  type: 'waitlist_promoted' | 'departed' | 'arrived';
  message: string;
  chatMessageBody?: string;
  runId: string;
  timestamp: number;
  read: boolean;
}

export interface AppEvent {
  id: string;
  type: 'login' | 'create_run' | 'join_run' | 'depart' | 'arrival' | 'waitlist_add';
  userEmail: string;
  timestamp: number;
  metadata?: any;
}

export interface ImageGenerationConfig {
  aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  imageSize: '1K' | '2K' | '4K';
}
