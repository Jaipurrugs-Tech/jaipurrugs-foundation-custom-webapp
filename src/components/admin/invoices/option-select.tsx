"use client";

import { Label, ListBox, Select } from "@heroui/react";

const NONE = "__none";

/** A labelled single-choice Select over `{ id, label }` options; "" means nothing chosen. */
export function OptionSelect({
  label,
  value,
  onChange,
  options,
  noneLabel,
  isRequired,
  isDisabled,
  placeholder,
  className,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { id: string; label: string; muted?: string }[];
  noneLabel?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  placeholder?: string;
  className?: string;
  hideLabel?: boolean;
}) {
  return (
    <Select
      aria-label={hideLabel ? label : undefined}
      className={className}
      isDisabled={isDisabled}
      isRequired={isRequired}
      placeholder={placeholder}
      value={value || (noneLabel ? NONE : null)}
      onChange={(key) => onChange(!key || key === NONE ? "" : String(key))}
    >
      {hideLabel ? null : <Label>{label}</Label>}
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {noneLabel ? (
            <ListBox.Item id={NONE} textValue={noneLabel}>
              <span className="text-muted">{noneLabel}</span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ) : null}
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              <span>
                {option.label}
                {option.muted ? <span className="text-muted"> · {option.muted}</span> : null}
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
