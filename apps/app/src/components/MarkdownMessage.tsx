import { useMemo } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import Markdown, { type RenderRules } from "react-native-markdown-display";
import type { Palette } from "../lib/theme";

/**
 * Renderiza el texto del agente como Markdown (encabezados, listas, negritas,
 * tablas, citas, código…) con estilos atados a la paleta del tema. Sustituye al
 * `<Text>` plano que mostraba el Markdown crudo y se leía mal.
 */
export function MarkdownMessage({ text, palette }: { text: string; palette: Palette }) {
  const styles = useMemo(() => makeMarkdownStyles(palette), [palette]);
  const rules = useMemo(() => makeRules(palette), [palette]);
  return (
    <Markdown
      style={styles}
      rules={rules}
      onLinkPress={(url) => {
        void Linking.openURL(url);
        return false;
      }}
    >
      {text}
    </Markdown>
  );
}

/** Código (inline y en bloque) comparte este look monoespaciado y oscuro. */
const CODE_BG = "#0f172a";
const CODE_FG = "#e2e8f0";

/**
 * Los bloques de código y las tablas pueden ser más anchos que la pantalla:
 * los envolvemos en un scroll horizontal para no romper el layout ni recortar.
 */
function makeRules(palette: Palette): RenderRules {
  const codeText = { color: CODE_FG, fontFamily: "monospace", fontSize: 12.5 };
  const renderFence: RenderRules["fence"] = (node, _children, _parent, styles) => (
    <ScrollView
      key={node.key}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.fence}
      contentContainerStyle={fenceContent}
    >
      <Text style={codeText}>{node.content}</Text>
    </ScrollView>
  );
  return {
    fence: renderFence,
    code_block: renderFence,
    table: (node, children) => (
      <ScrollView
        key={node.key}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={tableScroll(palette)}
      >
        <View>{children}</View>
      </ScrollView>
    ),
  };
}

const fenceContent = { padding: 12 } as const;
const tableScroll = (palette: Palette) => ({
  borderColor: palette.border,
  borderWidth: StyleSheet.hairlineWidth,
  borderRadius: 8,
  marginVertical: 6,
});

function makeMarkdownStyles(p: Palette) {
  return StyleSheet.create({
    body: { color: p.text, fontSize: 15, lineHeight: 22 },
    paragraph: { marginTop: 0, marginBottom: 10, flexWrap: "wrap" },
    heading1: { color: p.text, fontSize: 21, fontWeight: "700", marginTop: 6, marginBottom: 8 },
    heading2: { color: p.text, fontSize: 18, fontWeight: "700", marginTop: 6, marginBottom: 6 },
    heading3: { color: p.text, fontSize: 16, fontWeight: "700", marginTop: 4, marginBottom: 4 },
    heading4: { color: p.text, fontSize: 15, fontWeight: "700", marginTop: 4, marginBottom: 4 },
    strong: { fontWeight: "700", color: p.text },
    em: { fontStyle: "italic" },
    s: { textDecorationLine: "line-through" },
    link: { color: p.primary, textDecorationLine: "underline" },
    blockquote: {
      backgroundColor: p.badgeBg,
      borderLeftColor: p.primary,
      borderLeftWidth: 3,
      borderRadius: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginVertical: 6,
    },
    bullet_list: { marginBottom: 6 },
    ordered_list: { marginBottom: 6 },
    list_item: { marginVertical: 2 },
    code_inline: {
      color: CODE_FG,
      backgroundColor: CODE_BG,
      fontFamily: "monospace",
      fontSize: 13,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
    },
    fence: { backgroundColor: CODE_BG, borderRadius: 8, marginVertical: 6 },
    code_block: { backgroundColor: CODE_BG, borderRadius: 8, marginVertical: 6 },
    hr: { backgroundColor: p.border, height: StyleSheet.hairlineWidth, marginVertical: 10 },
    table: { borderWidth: 0 },
    thead: {},
    th: {
      padding: 8,
      fontWeight: "700",
      color: p.text,
      borderColor: p.border,
      borderWidth: StyleSheet.hairlineWidth,
    },
    td: {
      padding: 8,
      color: p.text,
      borderColor: p.border,
      borderWidth: StyleSheet.hairlineWidth,
      minWidth: 80,
    },
  });
}
