/// An insertion-order-preserving `String`-keyed container, the Swift stand-in for
/// a plain JavaScript object. Node preserves object-key insertion order and the
/// reference serializers depend on it (`Object.entries` + `JSON.stringify`);
/// Swift's `Dictionary` is unordered, so this type records the key order
/// explicitly. It backs both `JSONObject` (nested custom-field payloads) and
/// `Contact.customFields`, so byte-identical output survives a round-trip.
///
/// Ergonomics mirror `Dictionary`: subscript-by-key (upsert keeps a key's
/// original position, assigning `nil` removes it), `keys` in insertion order, a
/// dictionary literal that preserves written order, and `Codable` that *encodes*
/// in insertion order. Decoding cannot recover document order from a keyed
/// container, so a decoded container's order is unspecified — acceptable because
/// the byte-critical paths build the container from the format parsers (which
/// insert in encounter order), never from `Codable`. Equality is by
/// key→value mapping (order-insensitive), matching JS `===`-style value equality
/// and keeping `Codable` round-trips robust; ordering is proven by the golden
/// byte-identity tests, not by `==`.
public struct OrderedDictionary<Value> {
    public private(set) var keys: [String]
    private var storage: [String: Value]

    public init() {
        keys = []
        storage = [:]
    }

    /// Build from ordered pairs, preserving first-seen order (later duplicate
    /// keys update the value in place).
    public init(_ pairs: [(String, Value)]) {
        keys = []
        storage = [:]
        for (key, value) in pairs { self[key] = value }
    }

    public var isEmpty: Bool { keys.isEmpty }
    public var count: Int { keys.count }

    public subscript(key: String) -> Value? {
        get { storage[key] }
        set {
            if let newValue {
                if storage[key] == nil { keys.append(key) }
                storage[key] = newValue
            } else if storage[key] != nil {
                storage[key] = nil
                keys.removeAll { $0 == key }
            }
        }
    }

    /// The (key, value) pairs in insertion order.
    public var pairs: [(key: String, value: Value)] {
        keys.map { (key: $0, value: storage[$0]!) }
    }
}

extension OrderedDictionary: Sendable where Value: Sendable {}

extension OrderedDictionary: Equatable where Value: Equatable {
    /// Order-insensitive: equal iff the same keys map to the same values.
    public static func == (lhs: OrderedDictionary, rhs: OrderedDictionary) -> Bool {
        lhs.storage == rhs.storage
    }
}

extension OrderedDictionary: ExpressibleByDictionaryLiteral {
    public init(dictionaryLiteral elements: (String, Value)...) {
        self.init(elements)
    }
}

extension OrderedDictionary: Codable where Value: Codable {
    private struct DynamicKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ string: String) { stringValue = string }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicKey.self)
        var keys: [String] = []
        var storage: [String: Value] = [:]
        for key in container.allKeys {
            storage[key.stringValue] = try container.decode(Value.self, forKey: key)
            keys.append(key.stringValue)
        }
        self.keys = keys
        self.storage = storage
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: DynamicKey.self)
        for key in keys {
            try container.encode(storage[key]!, forKey: DynamicKey(key))
        }
    }
}

/// An order-preserving JSON object (nested custom-field payload). See
/// `OrderedDictionary`.
public typealias JSONObject = OrderedDictionary<JSONValue>

/// A losslessly round-trippable JSON value, used for open-vocabulary custom
/// fields (`TypedField.value` / `metadata`). Mirrors the arbitrary JSON that the
/// JS `customFields[key].value` can hold (see `js/vcf-parser.js` X-CONSTELLATION-FIELD).
/// Object keys preserve insertion order via `JSONObject` so nested payloads
/// re-serialize byte-identically to Node.
public enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object(JSONObject)

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let b = try? container.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? container.decode(Double.self) {
            self = .number(n)
        } else if let s = try? container.decode(String.self) {
            self = .string(s)
        } else if let a = try? container.decode([JSONValue].self) {
            self = .array(a)
        } else if let o = try? container.decode(JSONObject.self) {
            self = .object(o)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value"
            )
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .number(let n): try container.encode(n)
        case .bool(let b): try container.encode(b)
        case .null: try container.encodeNil()
        case .array(let a): try container.encode(a)
        case .object(let o): try container.encode(o)
        }
    }
}
