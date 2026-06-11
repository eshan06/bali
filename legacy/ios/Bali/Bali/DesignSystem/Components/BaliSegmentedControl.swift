//
//  BaliSegmentedControl.swift
//  Bali — design system
//
//  Segmented control (.seg): #E9ECF2 track, 3pt padding, selected segment is a
//  white pill with sh-1. Used for Code/Link/QR and the grade picker.
//

import SwiftUI

struct BaliSegmentedControl<Value: Hashable>: View {
    let items: [Value]
    @Binding var selection: Value
    let label: (Value) -> String

    @Namespace private var pill

    var body: some View {
        HStack(spacing: 3) {
            ForEach(items, id: \.self) { item in
                let isSelected = item == selection
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        selection = item
                    }
                } label: {
                    Text(label(item))
                        .font(BaliFont.at(14, 600))
                        .foregroundStyle(isSelected ? BaliColor.ink : BaliColor.ink3)
                        .frame(maxWidth: .infinity)
                        .frame(height: 38)
                        .background {
                            if isSelected {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(BaliColor.surface)
                                    .matchedGeometryEffect(id: "pill", in: pill)
                                    .baliShadow(.card)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(BaliColor.segTrack)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
    }
}

#Preview {
    struct Demo: View {
        @State private var method = "Code"
        @State private var grade = "11"
        var body: some View {
            VStack(spacing: 20) {
                BaliSegmentedControl(items: ["Code", "Link", "QR"],
                                     selection: $method) { $0 }
                BaliSegmentedControl(items: ["9", "10", "11", "12"],
                                     selection: $grade) { $0 }
            }
            .padding()
            .background(BaliColor.bg)
        }
    }
    return Demo()
}
