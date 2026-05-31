//
//  BaliScreen.swift
//  Bali — design system
//
//  Standard scrolling screen scaffold mirroring `.screen-scroll`: 20pt
//  horizontal padding, 56pt top inset, and a bottom inset that clears the tab
//  bar (112) or not (40) for pushed screens. Hidden scroll indicators, app
//  background, pull-to-refresh hook.
//

import SwiftUI

struct BaliScreen<Content: View>: View {
    var hasTabBar: Bool = true
    var spacing: CGFloat = BaliSpacing.xxl
    var background: Color = BaliColor.bg
    var onRefresh: (() async -> Void)? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: spacing) {
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, BaliSpacing.screenH)
            .padding(.top, BaliSpacing.contentTop)
            .padding(.bottom, hasTabBar ? BaliSpacing.contentBottomTabbed : BaliSpacing.contentBottom)
        }
        .scrollIndicators(.hidden)
        .background(background.ignoresSafeArea())
        .modifier(RefreshableIfPresent(onRefresh: onRefresh))
    }
}

private struct RefreshableIfPresent: ViewModifier {
    let onRefresh: (() async -> Void)?
    func body(content: Content) -> some View {
        if let onRefresh {
            content.refreshable { await onRefresh() }
        } else {
            content
        }
    }
}

/// A simple screen header: eyebrow + display title, with optional trailing
/// accessory (e.g. the bell or "+" button). `eyebrow` is optional via an
/// explicit init so call sites with an accessory can omit it too.
struct ScreenHeader<Accessory: View>: View {
    let eyebrow: String?
    let title: String
    let titleColor: Color
    @ViewBuilder var accessory: () -> Accessory

    init(eyebrow: String? = nil,
         title: String,
         titleColor: Color = BaliColor.ink,
         @ViewBuilder accessory: @escaping () -> Accessory) {
        self.eyebrow = eyebrow
        self.title = title
        self.titleColor = titleColor
        self.accessory = accessory
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                if let eyebrow {
                    Eyebrow(eyebrow, muted: true)
                }
                BaliText(title, .display, color: titleColor)
            }
            Spacer(minLength: BaliSpacing.m)
            accessory()
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] }
        }
    }
}

extension ScreenHeader where Accessory == EmptyView {
    init(eyebrow: String? = nil, title: String, titleColor: Color = BaliColor.ink) {
        self.init(eyebrow: eyebrow, title: title, titleColor: titleColor) { EmptyView() }
    }
}
