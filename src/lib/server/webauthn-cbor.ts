// Minimal CBOR (RFC 8949) decoder covering the subset WebAuthn actually emits:
// attestation objects and COSE_Key structures. This is deliberately NOT a
// general CBOR library — the repository has no CBOR dependency and pulling one
// in for two fixed shapes would be more surface than writing the decoder.
//
// What WebAuthn needs:
//   - major 0/1  unsigned + negative integers (COSE labels are negative)
//   - major 2/3  byte strings (keys, signatures) and text strings (map keys)
//   - major 4/5  arrays and maps
//   - major 7    the simple values true/false/null
//
// Everything else — indefinite-length items, tags, floats, bignums — is
// rejected rather than skipped. A decoder that silently tolerates what it does
// not understand is how a parser differential becomes an auth bypass, and this
// code sits directly under signature verification.

export class CborError extends Error {
  constructor(message: string) {
    super(`cbor: ${message}`);
    this.name = "CborError";
  }
}

export type CborValue =
  | number
  | bigint
  | string
  | Uint8Array
  | boolean
  | null
  | CborValue[]
  | Map<string | number | bigint, CborValue>;

export type CborDecoded = { value: CborValue; offset: number };

// Integers up to 2^53-1 come back as `number`; anything larger stays `bigint`
// so a 64-bit length can never silently lose precision on the way to a slice
// bound.
function toSafeInteger(value: bigint): number | bigint {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}

function readUint(bytes: Uint8Array, offset: number, count: number): { value: bigint; offset: number } {
  if (offset + count > bytes.length) throw new CborError("truncated integer");
  // BigInt LITERALS (0n) need an ES2020 target; this project targets lower,
  // so the constants are constructed instead.
  const eight = BigInt(8);
  let value = BigInt(0);
  for (let index = 0; index < count; index += 1) {
    value = (value << eight) | BigInt(bytes[offset + index]);
  }
  return { value, offset: offset + count };
}

// The argument of a CBOR head: either packed into the low 5 bits, or carried in
// the following 1/2/4/8 bytes. 28-30 are reserved; 31 marks indefinite length.
function readArgument(
  bytes: Uint8Array,
  offset: number,
  additional: number,
): { value: bigint; offset: number } {
  if (additional < 24) return { value: BigInt(additional), offset };
  if (additional === 24) return readUint(bytes, offset, 1);
  if (additional === 25) return readUint(bytes, offset, 2);
  if (additional === 26) return readUint(bytes, offset, 4);
  if (additional === 27) return readUint(bytes, offset, 8);
  if (additional === 31) throw new CborError("indefinite-length items are not supported");
  throw new CborError(`reserved additional information ${additional}`);
}

// Arguments always arrive as bigint (a CBOR head can carry 64 bits). Narrow to
// a usable length here rather than at each call site, so an out-of-range count
// fails loudly instead of wrapping into a plausible-looking slice bound.
function requireLength(bytes: Uint8Array, offset: number, length: bigint): number {
  if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CborError("length exceeds addressable range");
  }
  const count = Number(length);
  if (offset + count > bytes.length) throw new CborError("truncated item");
  return count;
}

function decodeAt(bytes: Uint8Array, offset: number, depth: number): CborDecoded {
  // WebAuthn structures nest three or four deep at most. The cap is a cheap
  // stack-overflow guard on attacker-supplied bytes.
  if (depth > 16) throw new CborError("nesting too deep");
  if (offset >= bytes.length) throw new CborError("unexpected end of input");

  const head = bytes[offset];
  const major = head >> 5;
  const additional = head & 0x1f;
  const argument = readArgument(bytes, offset + 1, additional);

  switch (major) {
    case 0:
      return { value: toSafeInteger(argument.value), offset: argument.offset };
    case 1: {
      // Negative integers encode -1 - n.
      const negative = BigInt(-1) - argument.value;
      const asNumber = Number(negative);
      return {
        value: Number.isSafeInteger(asNumber) ? asNumber : negative,
        offset: argument.offset,
      };
    }
    case 2: {
      const length = requireLength(bytes, argument.offset, argument.value);
      return {
        value: bytes.slice(argument.offset, argument.offset + length),
        offset: argument.offset + length,
      };
    }
    case 3: {
      const length = requireLength(bytes, argument.offset, argument.value);
      const slice = bytes.slice(argument.offset, argument.offset + length);
      return {
        value: new TextDecoder("utf-8", { fatal: true }).decode(slice),
        offset: argument.offset + length,
      };
    }
    case 4: {
      const count = requireLength(bytes, argument.offset, argument.value);
      const items: CborValue[] = [];
      let cursor = argument.offset;
      for (let index = 0; index < count; index += 1) {
        const item = decodeAt(bytes, cursor, depth + 1);
        items.push(item.value);
        cursor = item.offset;
      }
      return { value: items, offset: cursor };
    }
    case 5: {
      const count = requireLength(bytes, argument.offset, argument.value);
      const map = new Map<string | number | bigint, CborValue>();
      let cursor = argument.offset;
      for (let index = 0; index < count; index += 1) {
        const key = decodeAt(bytes, cursor, depth + 1);
        if (
          typeof key.value !== "string" &&
          typeof key.value !== "number" &&
          typeof key.value !== "bigint"
        ) {
          throw new CborError("map keys must be integers or text strings");
        }
        // A duplicate key is a canonical-encoding violation, and tolerating it
        // means two parsers can disagree about which value wins.
        if (map.has(key.value)) throw new CborError(`duplicate map key ${String(key.value)}`);
        const value = decodeAt(bytes, key.offset, depth + 1);
        map.set(key.value, value.value);
        cursor = value.offset;
      }
      return { value: map, offset: cursor };
    }
    case 7: {
      if (additional === 20) return { value: false, offset: argument.offset };
      if (additional === 21) return { value: true, offset: argument.offset };
      if (additional === 22) return { value: null, offset: argument.offset };
      throw new CborError(`unsupported simple value ${additional}`);
    }
    default:
      throw new CborError(`unsupported major type ${major}`);
  }
}

/**
 * Decode one CBOR item, reporting where it ended. Trailing bytes are the
 * caller's business — the COSE key inside authenticator data is followed by
 * optional extension data, so `offset` is how the caller finds the boundary.
 */
export function decodeCborItem(bytes: Uint8Array): CborDecoded {
  return decodeAt(bytes, 0, 0);
}

/**
 * Decode a CBOR item that must consume the entire input. Attestation objects
 * are framed exactly, so trailing bytes mean the input is not what it claims.
 */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const decoded = decodeAt(bytes, 0, 0);
  if (decoded.offset !== bytes.length) {
    throw new CborError(`${bytes.length - decoded.offset} trailing byte(s) after item`);
  }
  return decoded.value;
}
