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
        ),
        .executable(
            name: "constellation-dump",
            targets: ["constellation-dump"]
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
        .target(
            name: "ConstellationTestSupport"
        ),
        .executableTarget(
            name: "constellation-dump",
            dependencies: ["ConstellationModel", "ConstellationFormats"]
        ),
        .testTarget(
            name: "ModelTests",
            dependencies: ["ConstellationModel"]
        ),
        .testTarget(
            name: "FormatsTests",
            dependencies: ["ConstellationFormats", "ConstellationTestSupport"]
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
