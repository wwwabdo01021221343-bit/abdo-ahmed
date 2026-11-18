export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  buyWholesale?: number | null;
  sellDozenRetail?: number | null;
  wholesalePrice?: number | null;
  dozenPrice?: number | null;
  image?: string;
  barcode?: string;
  stock?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CartItem {
  id: string;
  productId?: string;
  name: string;
  price: number;
  originalPrice?: number;
  quantity: number;
  category?: string;
  unit?: 'piece' | 'dozen';
}

export interface Invoice {
  id: string;
  customer?: string;
  items: CartItem[];
  total: number;
  date: string;
  updatedAt?: string;
  discount?: number;
  notes?: string;
}

export interface ShortageItem {
  id: string;
  name: string;
  quantity: number;
  category?: string;
  done: boolean;
  date: string;
  updatedAt?: string;
  notes?: string;
}

export interface StoreSettings {
  shop: string;
  phone: string;
  address?: string;
  tagline?: string;
}

export type TrashEntityType = 'product' | 'invoice' | 'shortage';

export interface TrashItem {
  id: string;
  entityType: TrashEntityType;
  originalId: string;
  title: string;
  subtitle?: string;
  data: Product | Invoice | ShortageItem;
  deletedAt: string;
  expiresAt: string;
  deletedBy?: string;
}

export type CloudBackupReason = 'auto_daily' | 'manual' | 'pre_wipe' | 'pre_restore';

export interface CloudBackupManifest {
  id: string;
  dateKey: string;
  label: string;
  reason: CloudBackupReason;
  productCount: number;
  categoryCount: number;
  invoiceCount: number;
  shortageCount: number;
  chunkCount: number;
  settings?: StoreSettings;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface CloudBackupChunk {
  id: string;
  backupId: string;
  chunkIndex: number;
  products: Product[];
  invoices: Invoice[];
  shortages: ShortageItem[];
}

export interface AppDatabase {
  products: Product[];
  invoices: Invoice[];
  shortages: ShortageItem[];
  settings: StoreSettings;
  trash?: TrashItem[];
}

export type PrintCatalogMode = 'none' | 'retail' | 'buy' | 'dozen';
