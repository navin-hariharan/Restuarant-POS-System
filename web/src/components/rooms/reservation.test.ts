import { describe, expect, it } from 'vitest';
import { hoursBetween, overlappingSlots, roomCharges, type GuestRoom } from './reservation';
import { phpDateSample } from '@/components/settings/LocalizationTab';

const room: GuestRoom = {
  id: 1,
  room_name: 'R1',
  capactity: 2,
  per_hour_charges: '10.00',
  per_use_charges: '50.00',
  layout: null,
  reserved_slots: [{ reserved_at_date: '2030-01-01', reserved_at_time: '10:00', reserved_till_date: '2030-01-02', reserved_till_time: '09:00' }],
};

describe('reservation math', () => {
  it('counts hours across days', () => {
    expect(hoursBetween('2030-01-01', '22:00', '2030-01-02', '01:30')).toBe(3.5);
    expect(hoursBetween('2030-01-02', '10:00', '2030-01-01', '10:00')).toBe(0);
  });
  it('prices per hour and per use with tax', () => {
    expect(roomCharges({ room, perUse: false, hours: 3, tax: { tax_rate: 10 } })).toEqual({ charges: 10, subTotal: 30, taxAmount: 3, total: 33 });
    expect(roomCharges({ room, perUse: true, hours: 3, tax: { tax_rate: 20, is_vat: true, is_tax_included: true } }).total).toBe(50);
    expect(roomCharges({ room, perUse: false, hours: 2, tax: { tax_rate: 5, is_tax_fix: true } }).total).toBe(25);
  });
  it('detects overlaps with real date-times (overnight slot)', () => {
    const at = (d: string, t: string) => new Date(`${d}T${t}`);
    expect(overlappingSlots(room, at('2030-01-01', '23:00'), at('2030-01-02', '01:00'))).toHaveLength(1);
    expect(overlappingSlots(room, at('2030-01-02', '09:00'), at('2030-01-02', '11:00'))).toHaveLength(0);
    expect(overlappingSlots(room, at('2030-01-01', '23:00'), at('2030-01-02', '01:00'), room.reserved_slots[0])).toHaveLength(0);
  });
});

describe('phpDateSample', () => {
  it('renders PHP date tokens', () => {
    const d = new Date(2026, 2, 7, 14, 5, 9);
    expect(phpDateSample('d-m-Y H:i:s', d)).toBe('07-03-2026 14:05:09');
    expect(phpDateSample('d D M Y', d)).toBe('07 Sat Mar 2026');
  });
});
