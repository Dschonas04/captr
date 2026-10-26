// Ersatz fuer @storyteller/ui-action-reminder-modal: Rueckfrage per Dialog.
import type { ComponentType, ReactNode } from "react";

export const isActionReminderOpen = { value: false };

export function showActionReminder(o: {
  title: string;
  message?: ReactNode;
  primaryActionText: string;
  onPrimaryAction: () => void;
  reminderType?: string;
  primaryActionIcon?: ComponentType;
  primaryActionBtnClassName?: string;
}) {
  isActionReminderOpen.value = true;
  window.dispatchEvent(new CustomEvent("captr:rueckfrage", { detail: o }));
}
