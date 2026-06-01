//
//  HomeView.swift
//  Bali — Home tab
//
//  The daily hub. A greeting + bell, then a hero that adapts to the live state
//  (a live class you haven't checked into → blue "tap to check in"; checked in →
//  dark "Focus active"; nothing live → resting), an attendance + streak stat
//  row, and "Your classes". Pull-to-refresh + the load/error states come from
//  AppModel.
//

import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouter.self) private var router
    @Environment(NotificationManager.self) private var notifications

    var body: some View {
        BaliScreen(onRefresh: { await model.refresh() }) {
            header

            if model.classes.isEmpty {
                switch model.phase {
                case .loading, .idle:
                    LoadingCard()
                case .failed:
                    ErrorStateCard(message: model.errorMessage) { Task { await model.load() } }
                case .loaded:
                    EmptyClassesCard { router.push(.join, on: .home) }
                }
            } else {
                hero
                statRow
                classesSection
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                BaliText(greeting, .body)
                BaliText("\(model.student?.firstName ?? "there").", .display)
            }
            Spacer(minLength: BaliSpacing.m)
            IconButton(systemImage: "bell", showsBadge: notifications.unreadCount > 0) {
                router.push(.notifications, on: .home)
            }
        }
    }

    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5..<12:  return "Good morning,"
        case 12..<17: return "Good afternoon,"
        default:      return "Good evening,"
        }
    }

    // MARK: - Hero

    @ViewBuilder private var hero: some View {
        if let live = model.liveClass {
            if model.isCheckedIn(live) { checkedInHero(live) } else { liveHero(live) }
        } else {
            restingHero
        }
    }

    private func liveHero(_ live: StudentClassSummary) -> some View {
        let seat = model.presentation(for: live.id).seat
        return VStack(alignment: .leading, spacing: 14) {
            heroBadge("CLASS IS LIVE")
            VStack(alignment: .leading, spacing: 6) {
                BaliText("\(live.name) started", .h1, color: .white)
                Text(seat.map { "Tap your Bali block at \($0) to check in." }
                        ?? "Tap your Bali block to check in.")
                    .baliText(.body, color: .white.opacity(0.9))
            }
            checkInPill { router.startCheckIn(classId: live.id) }
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            BaliGradient.blueHero.overlay(alignment: .trailing) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .font(.system(size: 150, weight: .regular))
                    .foregroundStyle(.white.opacity(0.10))
                    .offset(x: 34)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.lg, style: .continuous))
        .baliShadow(.blue)
    }

    private func checkedInHero(_ live: StudentClassSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            heroBadge("FOCUS ACTIVE", dot: BaliColor.green)
            VStack(alignment: .leading, spacing: 6) {
                BaliText("You're checked in", .h1, color: .white)
                Text("\(live.name) · Focus Mode is keeping you on task.")
                    .baliText(.body, color: BaliColor.focusText2)
            }
            BaliButton(title: "View Focus Mode", icon: "shield.fill",
                       variant: .glass, fullWidth: false) { router.selectTab(.focus) }
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BaliGradient.darkCard)
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.lg, style: .continuous))
        .baliShadow(.elevated)
    }

    private var restingHero: some View {
        let nextHint = model.classes
            .compactMap { model.presentation(for: $0.id).nextLabel }.first
        return Card {
            HStack(spacing: BaliSpacing.l) {
                IconTile(systemImage: "checkmark", tone: .green, size: 48, glyphSize: 20)
                VStack(alignment: .leading, spacing: 3) {
                    BaliText("No class is live", .h3)
                    BaliText(nextHint ?? "You're all caught up.", .foot)
                }
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: - Stat row

    private var statRow: some View {
        HStack(spacing: BaliSpacing.m) {
            HomeStatCard(visual: .ring(model.averageAttendance / 100),
                         title: "Attendance",
                         subtitle: "across \(model.classes.count) class\(model.classes.count == 1 ? "" : "es")")
            if let streak = model.extras.streak {
                HomeStatCard(visual: .icon("flame.fill", .amber),
                             title: "\(streak)-day streak", subtitle: "on-time check-ins")
            } else {
                HomeStatCard(visual: .icon("books.vertical.fill", .blue),
                             title: "\(model.classes.count) classes", subtitle: "this term")
            }
        }
    }

    // MARK: - Classes

    private var classesSection: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.m) {
            HStack {
                BaliText("Your classes", .h3)
                Spacer()
                Button { router.selectTab(.classes) } label: {
                    BaliText("See all", .label, color: BaliColor.blue)
                }
                .buttonStyle(.plain)
            }
            ForEach(model.classes) { c in
                ClassCard(summary: c,
                          policy: model.presentation(for: c.id).policy,
                          nextLabel: model.presentation(for: c.id).nextLabel,
                          isCheckedIn: model.isCheckedIn(c)) {
                    router.push(.classDetail(classId: c.id), on: .home)
                }
            }
        }
    }

    // MARK: - Hero pieces

    private func heroBadge(_ text: String, dot: Color = .white) -> some View {
        HStack(spacing: 7) {
            PulseDot(color: dot, size: 6)
            Text(text)
                .font(BaliFont.at(11.5, 700)).tracking(1)
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 11)
        .frame(height: 26)
        .background(Color.white.opacity(0.18))
        .clipShape(Capsule())
    }

    private func checkInPill(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "dot.radiowaves.left.and.right")
                Text("Tap to check in")
            }
            .font(BaliFont.at(16, 650))
            .foregroundStyle(BaliColor.blue)
            .padding(.horizontal, 20)
            .frame(height: 48)
            .background(Color.white)
            .clipShape(Capsule())
        }
        .buttonStyle(CardPressStyle())
    }
}

/// A small dashboard stat card: a ring or icon-tile visual + title + subtitle.
private struct HomeStatCard: View {
    enum Visual { case ring(Double); case icon(String, BaliTone) }
    let visual: Visual
    let title: String
    let subtitle: String

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: BaliSpacing.m) {
                switch visual {
                case .ring(let progress):
                    AttendanceRing(progress: progress, color: BaliColor.blue, size: 50, lineWidth: 5)
                case .icon(let symbol, let tone):
                    IconTile(systemImage: symbol, tone: tone, size: 50, glyphSize: 21)
                }
                VStack(alignment: .leading, spacing: 2) {
                    BaliText(title, .bodyStrong)
                    BaliText(subtitle, .foot)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

#Preview {
    NavigationStack { HomeView() }
        .injectBaliEnvironment(.preview())
}
