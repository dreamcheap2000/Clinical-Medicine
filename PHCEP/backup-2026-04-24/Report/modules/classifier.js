/**
 * classifier.js
 * Applies abnormality_rules from a template to a report's field values
 * and returns an array of classification tags.
 */

export function classifyReport(template, fieldValues) {
  const tags = [];
  const rules = template.abnormality_rules || [];

  for (const rule of rules) {
    const raw = fieldValues[rule.field];
    if (raw === undefined || raw === null || raw === '') continue;

    // Normalise value — could be string or array (multiselect)
    const isArray = Array.isArray(raw);
    const strVal  = isArray ? raw.join(' | ') : String(raw);

    let match = false;

    if (rule.equals !== undefined) {
      match = strVal === String(rule.equals);
    } else if (rule.not_equals !== undefined) {
      match = strVal !== String(rule.not_equals);
    } else if (rule.in !== undefined) {
      if (isArray) {
        match = raw.some(v => rule.in.includes(v));
      } else {
        match = rule.in.includes(strVal);
      }
    } else if (rule.contains !== undefined) {
      if (isArray) {
        match = raw.some(v => String(v).toLowerCase().includes(String(rule.contains).toLowerCase()));
      } else {
        match = strVal.toLowerCase().includes(String(rule.contains).toLowerCase());
      }
    } else if (rule.not_contains !== undefined) {
      if (isArray) {
        match = !raw.some(v => String(v).toLowerCase().includes(String(rule.not_contains).toLowerCase()));
      } else {
        match = !strVal.toLowerCase().includes(String(rule.not_contains).toLowerCase());
      }
    } else if (rule.gt !== undefined) {
      const num = parseFloat(strVal);
      match = !isNaN(num) && num > rule.gt;
    } else if (rule.lt !== undefined) {
      const num = parseFloat(strVal);
      match = !isNaN(num) && num < rule.lt;
    } else if (rule.gte !== undefined) {
      const num = parseFloat(strVal);
      match = !isNaN(num) && num >= rule.gte;
    } else if (rule.lte !== undefined) {
      const num = parseFloat(strVal);
      match = !isNaN(num) && num <= rule.lte;
    }

    if (match && rule.classify && !tags.includes(rule.classify)) {
      tags.push(rule.classify);
    }
  }

  return tags;
}
