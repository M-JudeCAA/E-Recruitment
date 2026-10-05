// A phone number reduced to what identifies it: its last nine digits. A
// Ugandan number is nine digits after the 0 or +256, so "+256 772 123 456",
// "256772123456" and "0772-123456" all give "772123456". Anything with
// fewer than nine digits isn't a usable number and gives null.
const KEY_DIGITS = 9;

function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= KEY_DIGITS ? digits.slice(-KEY_DIGITS) : null;
}

module.exports = { phoneKey };
