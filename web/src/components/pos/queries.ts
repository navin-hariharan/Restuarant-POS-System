import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Category, Customer, PaymentMethod, PickupPoint, Reservation, ServiceTable, SubmittedOrder, Tax } from './types';

const get = async <T,>(url: string, params?: Record<string, any>) => (await api.get<T>(url, { params })).data;

export const posKeys = {
  categories: ['pos', 'categories'] as const,
  tables: ['pos', 'tables'] as const,
  pickupPoints: ['pos', 'pickup-points'] as const,
  taxes: ['pos', 'taxes'] as const,
  paymentMethods: ['pos', 'payment-methods'] as const,
  reservations: ['pos', 'reservations'] as const,
  submitted: ['pos', 'submitted-orders'] as const,
  customers: (search: string) => ['pos', 'customers', search] as const,
};

export const useCategories = () =>
  useQuery({ queryKey: posKeys.categories, queryFn: () => get<Category[]>('pos/categories') });

export const useServiceTables = (enabled = true) =>
  useQuery({ queryKey: posKeys.tables, queryFn: () => get<ServiceTable[]>('pos/avl-service-tables'), enabled, staleTime: 0 });

export const usePickupPoints = (enabled = true) =>
  useQuery({ queryKey: posKeys.pickupPoints, queryFn: () => get<PickupPoint[]>('pos/pickup-points'), enabled });

export const useTaxes = (enabled = true) =>
  useQuery({ queryKey: posKeys.taxes, queryFn: () => get<Tax[]>('pos/taxes'), enabled });

export const usePaymentMethods = (enabled = true) =>
  useQuery({ queryKey: posKeys.paymentMethods, queryFn: () => get<PaymentMethod[]>('pos/payment-methods'), enabled });

export const useReservations = (enabled = true) =>
  useQuery({ queryKey: posKeys.reservations, queryFn: () => get<Reservation[]>('pos/guest-rooms-reservations'), enabled, staleTime: 0 });

export const useSubmittedOrders = () =>
  useQuery({
    queryKey: posKeys.submitted,
    queryFn: async () => (await api.get<SubmittedOrder[]>('pos/get-submitted-orders', { silent: true })).data,
    refetchInterval: 40_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

export const useCustomerSearch = (search: string, enabled = true) =>
  useQuery({
    queryKey: posKeys.customers(search),
    queryFn: () => get<Customer[]>('pos/customers', search ? { search } : undefined),
    enabled,
    staleTime: 10_000,
  });
