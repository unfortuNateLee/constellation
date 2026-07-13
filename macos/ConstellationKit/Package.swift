// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ConstellationKit",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "ConstellationKit",
            targets: ["ConstellationUI", "ConstellationContactsSync"]
        )
    ],
    targets: [
        .target(
            name: "ConstellationModel"
        ),
        .target(
            name: "ConstellationFormats",
            dependencies: ["ConstellationModel"]
        ),
        .target(
            name: "ConstellationGraphModel",
            dependencies: ["ConstellationModel"]
        ),
        .target(
            name: "ConstellationStore",
            dependencies: ["ConstellationModel", "ConstellationFormats", "ConstellationGraphModel"]
        ),
        .target(
            name: "ConstellationContactsSync",
            dependencies: ["ConstellationModel"]
        ),
        .target(
            name: "ConstellationUI",
            dependencies: ["ConstellationModel", "ConstellationGraphModel", "ConstellationStore"]
        ),
        .testTarget(
            name: "FormatsTests",
            dependencies: ["ConstellationFormats"]
        ),
        .testTarget(
            name: "GraphModelTests",
            dependencies: ["ConstellationGraphModel"]
        ),
        .testTarget(
            name: "StoreTests",
            dependencies: ["ConstellationStore"]
        ),
        .testTarget(
            name: "ContactsSyncTests",
            dependencies: ["ConstellationContactsSync"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
