//
//  DetailScaffold.swift
//  Bali — design system
//
//  Scaffold for pushed detail screens: a scrolling body inset below a floating
//  top bar (back button on the left, optional trailing accessory). Mirrors the
//  `.topbar` + `.screen-scroll.no-tab` pattern. Uses the environment `dismiss`
//  to pop the navigation stack.
//

import SwiftUI

struct DetailScaffold<Content: View>: View {
    var trailingIcon: String? = nil
    var trailingAction: (() -> Void)? = nil
    var spacing: CGFloat = BaliSpacing.xxl
    @ViewBuilder var content: () -> Content

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: spacing) {
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, BaliSpacing.screenH)
            .padding(.top, 104)
            .padding(.bottom, BaliSpacing.contentBottom)
        }
        .scrollIndicators(.hidden)
        .background(BaliColor.bg.ignoresSafeArea())
        .overlay(alignment: .top) {
            HStack {
                IconButton(systemImage: "chevron.left") { dismiss() }
                Spacer()
                if let trailingIcon {
                    IconButton(systemImage: trailingIcon) { trailingAction?() }
                }
            }
            .padding(.horizontal, BaliSpacing.l)
            .padding(.top, BaliSpacing.contentTop)
        }
    }
}

/// A small, on-brand placeholder used by Phase 2 stub screens until the real
/// content lands in a later phase.
struct StubPlaceholder: View {
    let systemImage: String
    let title: String
    let note: String

    var body: some View {
        Card {
            VStack(spacing: BaliSpacing.m) {
                IconTile(systemImage: systemImage, tone: .blue, size: 52, glyphSize: 22)
                BaliText(title, .h3)
                BaliText(note, .foot)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, BaliSpacing.s)
        }
    }
}
