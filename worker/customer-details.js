export const CUSTOMER_NAME_MAX_LENGTH = 100;
export const CHILD_NAME_MAX_LENGTH = 60;

const NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u;

function normaliseName(value) {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function validateName(value, { field, label, maxLength, required }) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return { value: '' };
    return { error: `${label} must be entered as text.`, field };
  }
  const normalised = normaliseName(value);
  if (!normalised) {
    return required ? { error: `${label} is required.`, field } : { value: '' };
  }
  if ([...normalised].length > maxLength) {
    return { error: `${label} must be ${maxLength} characters or fewer.`, field };
  }
  if (!NAME_PATTERN.test(normalised)) {
    return { error: `${label} may contain letters, spaces, hyphens, and apostrophes only.`, field };
  }
  return { value: normalised };
}

export function validateCheckoutCustomerDetails(value, { required = true } = {}) {
  if (value === undefined || value === null) {
    return required
      ? { error: 'Customer Name is required.', field: 'customerName' }
      : { customerName: '', childName: '' };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Customer details are invalid.', field: 'customerName' };
  }

  const customer = validateName(value.customerName, {
    field: 'customerName', label: 'Customer Name', maxLength: CUSTOMER_NAME_MAX_LENGTH, required
  });
  if (customer.error) return customer;
  const child = validateName(value.childName, {
    field: 'childName', label: "Child's Name", maxLength: CHILD_NAME_MAX_LENGTH, required
  });
  if (child.error) return child;
  return { customerName: customer.value, childName: child.value };
}
