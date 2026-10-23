import React, { useEffect, useRef, useState } from "react";
import { displayDate, parseDisplayDate } from "../shared/dates.js";
export function DateField({
  value,
  onChange,
  name,
  label,
  max,
  required = false,
  errorText = "Enter a valid date as dd/mm/yyyy.",
}) {
  const [text, setText] = useState(value ? displayDate(value) : "");
  const ref = useRef(null);
  useEffect(() => {
    if (value !== null) {
      setText(value ? displayDate(value) : "");
      ref.current?.setCustomValidity("");
    }
  }, [value]);
  function update(event) {
    const raw = event.target.value;
    setText(raw);
    const day = parseDisplayDate(raw);
    const invalid = !!raw && (!day || (max && day > max));
    event.target.setCustomValidity(invalid ? errorText : "");
    event.target.setAttribute("aria-invalid", String(invalid));
    onChange?.(!raw ? "" : invalid ? null : day);
  }
  return (
    <input
      ref={ref}
      name={name}
      aria-label={label}
      type="text"
      inputMode="numeric"
      placeholder="dd/mm/yyyy"
      maxLength={10}
      required={required}
      value={text}
      onChange={update}
    />
  );
}
