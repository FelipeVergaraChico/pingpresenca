import { create } from 'zustand';
// Only ephemeral presentation. No credentials, permissions or official state.
export const useUiStore = create<{
  showPassword: boolean;
  togglePassword: () => void;
  section: string;
  offeringId: string;
  selectSection: (s: string) => void;
  selectOffering: (id: string) => void;
  reset: () => void;
}>((set) => ({
  showPassword: false,
  togglePassword: () => set((state) => ({ showPassword: !state.showPassword })),
  section: 'offerings',
  offeringId: '',
  selectSection: (section) => set({ section }),
  selectOffering: (offeringId) => set({ offeringId }),
  reset: () => set({ section: 'offerings', offeringId: '', showPassword: false }),
}));
