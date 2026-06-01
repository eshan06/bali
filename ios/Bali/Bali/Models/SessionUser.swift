//
//  SessionUser.swift
//  Bali — models
//
//  Mirrors the `Student` and `SessionUser` shapes in `packages/shared`. Only the
//  fields the student app consumes are modeled; JSON keys match the server's
//  camelCase exactly so no custom CodingKeys are needed.
//

import Foundation

nonisolated enum UserRole: String, Codable {
    case teacher
    case student
    case unset

    /// Decode unknown role strings as `.unset` rather than failing.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = UserRole(rawValue: raw) ?? .unset
    }
}

nonisolated struct Student: Codable, Identifiable, Equatable {
    let id: String
    var firstName: String
    var lastName: String
    var email: String?
    var grade: String?
    var schoolId: String?
    var externalId: String?
    var notes: String?

    var fullName: String {
        "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces)
    }

    /// Initials for the avatar (e.g. "MC").
    var initials: String {
        let f = firstName.first.map(String.init) ?? ""
        let l = lastName.first.map(String.init) ?? ""
        return (f + l).uppercased()
    }
}

nonisolated struct SessionUser: Codable, Equatable {
    let role: UserRole
    let sub: String
    let email: String
    let displayName: String
    let student: Student?
}
