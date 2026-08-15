import Foundation

struct MarketplaceConfigField: Codable, Hashable, Identifiable {
    var id: String { key }
    let key: String
    let env: String
    let title: String
    var description: String?
    let sensitive: Bool
}

struct MarketplaceLogoIdentity: Codable, Hashable {
    let kind: String
    let title: String
    let monogram: String
    let assetPath: String?
}

struct MarketplacePlugin: Codable, Hashable, Identifiable {
    let id: String
    let displayName: String
    let description: String
    let category: String
    let author: String
    let capabilities: [String]
    let kind: String
    let version: String
    var installed: Bool
    let updateAvailable: Bool
    let requiresSetup: Bool
    let available: Bool
    let requiredConfig: [MarketplaceConfigField]
    let configured: Bool
    let logo: MarketplaceLogoIdentity?
}

struct MarketplaceResponse: Codable {
    let ok: Bool
    let plugins: [MarketplacePlugin]
}
