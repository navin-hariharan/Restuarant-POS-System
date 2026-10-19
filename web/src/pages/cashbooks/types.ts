export type CashbookOrder = {
  id: number;
  uuid: string;
  tracking: string;
  cart_total_price: number;
  cart_total_cost: number;
  payable_after_all: number;
  discount_rate: number;
  is_discount_in_percentage: boolean;
  discount_amount: number;
  profit_after_all: number;
  tax_amount: number;
  customer: { name?: string; email?: string | null; phone?: string | null } | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** App\Http\Resources\CashBookResource */
export type Cashbook = {
  id: number;
  uuid: string;
  user: string;
  opening_amount: number;
  closed: boolean;
  sales_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_profit: number;
  sold_items: number;
  sales: number;
  in_progress: number;
  in_completed: number;
  in_cancelled: number;
  is_closable: boolean;
  expenses_amount: number;
  final_amount: number;
  orders: CashbookOrder[];
  created_at: string;
  updated_at: string;
};
