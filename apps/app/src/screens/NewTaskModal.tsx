import type { AgentCapability, AgentType, EffortLevel, Machine } from "@batuta/protocol";
import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { sendSignedCommand } from "../lib/commands";
import { isSpeechSupported, startDictation } from "../lib/speech";
import type { Palette } from "../lib/theme";
import { useThemeContext, useThemedStyles } from "../lib/theme-context";

const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Capacidades por defecto cuando la máquina aún no publicó las suyas (runner
 * viejo o sin reportar todavía). Mantiene la app usable durante el rollout.
 */
const FALLBACK_AGENTS: AgentCapability[] = [
  {
    agentType: "claude-code",
    label: "Claude Code",
    available: true,
    models: [
      { id: "claude-opus-4-8", label: "Opus 4.8" },
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Haiku 4.5" },
      { id: "claude-fable-5", label: "Fable 5" },
    ],
    supportsEffort: true,
    supportsPermissions: true,
    supportsUsage: true,
  },
  {
    agentType: "antigravity",
    label: "Antigravity",
    available: true,
    models: [],
    supportsEffort: false,
    supportsPermissions: false,
    supportsUsage: false,
  },
  {
    agentType: "opencode",
    label: "opencode",
    available: true,
    models: [],
    supportsEffort: false,
    supportsPermissions: true,
    supportsUsage: false,
  },
  {
    agentType: "echo",
    label: "Echo (prueba)",
    available: true,
    models: [],
    supportsEffort: false,
    supportsPermissions: false,
    supportsUsage: false,
  },
];

export function NewTaskModal({
  visible,
  machines,
  onClose,
}: {
  visible: boolean;
  machines: Machine[];
  onClose: () => void;
}) {
  const { palette } = useThemeContext();
  const styles = useThemedStyles(makeStyles);
  const [machineId, setMachineId] = useState<string | null>(null);
  const [agentType, setAgentType] = useState<AgentType>("claude-code");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<EffortLevel>("high");
  const [cwd, setCwd] = useState(".");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const stopDictation = useRef<(() => void) | null>(null);
  const speechOk = isSpeechSupported();

  const selectedMachine = machineId ?? machines[0]?.id ?? null;

  // Capacidades publicadas por la máquina seleccionada (modelos por agente, flags).
  // Si aún no publicó nada, usamos el fallback para no romper la app.
  const machine = machines.find((m) => m.id === selectedMachine);
  const published = (machine?.agents ?? []).filter((a) => a.available);
  const agents = published.length > 0 ? published : FALLBACK_AGENTS;
  const cap = agents.find((a) => a.agentType === agentType) ?? agents[0];
  const selectedModel = cap?.models.find((m) => m.id === model)?.id ?? cap?.models[0]?.id ?? null;

  const canLaunch =
    Boolean(selectedMachine) && Boolean(cap) && prompt.trim().length > 0 && !busy;

  const toggleDictation = (): void => {
    if (listening) {
      stopDictation.current?.();
      stopDictation.current = null;
      setListening(false);
      return;
    }
    const stop = startDictation({
      onText: (text) => setPrompt((prev) => (prev ? `${prev} ${text}` : text)),
      onEnd: () => {
        stopDictation.current = null;
        setListening(false);
      },
      onError: () => {
        stopDictation.current = null;
        setListening(false);
      },
    });
    if (stop) {
      stopDictation.current = stop;
      setListening(true);
    }
  };

  const launch = async (): Promise<void> => {
    if (!selectedMachine || !cap || !prompt.trim()) return;
    setBusy(true);
    try {
      await sendSignedCommand({
        type: "new_task",
        machineId: selectedMachine,
        agentType: cap.agentType,
        cwd: cwd.trim() || ".",
        prompt: prompt.trim(),
        // Solo lo que el agente soporta (catálogo no vacío / effort).
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(cap.supportsEffort ? { effort } : {}),
      });
      setPrompt("");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Nueva tarea</Text>
          {machines.length === 0 ? (
            <Text style={styles.muted}>Empareja una PC primero (ejecuta el runner: pair).</Text>
          ) : (
            <>
              <Text style={styles.label}>Máquina</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chips}>
                  {machines.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => setMachineId(m.id)}
                      style={[styles.chip, selectedMachine === m.id && styles.chipOn]}
                    >
                      <Text style={selectedMachine === m.id ? styles.chipOnText : styles.chipText}>
                        {m.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.label}>Agente</Text>
              <View style={styles.chips}>
                {agents.map((a) => (
                  <Pressable
                    key={a.agentType}
                    onPress={() => setAgentType(a.agentType)}
                    style={[styles.chip, cap?.agentType === a.agentType && styles.chipOn]}
                  >
                    <Text
                      style={cap?.agentType === a.agentType ? styles.chipOnText : styles.chipText}
                    >
                      {a.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {cap && cap.models.length > 0 ? (
                <>
                  <Text style={styles.label}>Modelo</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.chips}>
                      {cap.models.map((m) => (
                        <Pressable
                          key={m.id}
                          onPress={() => setModel(m.id)}
                          style={[styles.chip, selectedModel === m.id && styles.chipOn]}
                        >
                          <Text style={selectedModel === m.id ? styles.chipOnText : styles.chipText}>
                            {m.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </>
              ) : null}

              {cap?.supportsEffort ? (
                <>
                  <Text style={styles.label}>Razonamiento</Text>
                  <View style={styles.chips}>
                    {EFFORTS.map((e) => (
                      <Pressable
                        key={e}
                        onPress={() => setEffort(e)}
                        style={[styles.chip, effort === e && styles.chipOn]}
                      >
                        <Text style={effort === e ? styles.chipOnText : styles.chipText}>{e}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              {cap && !cap.supportsPermissions ? (
                <Text style={styles.warn}>
                  ⚠️ Este agente ejecuta sin pedir aprobación (no hay gating de permisos).
                </Text>
              ) : null}

              <Text style={styles.label}>Directorio (cwd)</Text>
              <TextInput
                style={styles.input}
                value={cwd}
                onChangeText={setCwd}
                autoCapitalize="none"
                placeholder="."
                placeholderTextColor={palette.muted}
              />

              <View style={styles.labelRow}>
                <Text style={styles.label}>Tarea</Text>
                {speechOk ? (
                  <Pressable onPress={toggleDictation} style={styles.mic}>
                    <Text style={listening ? styles.micOn : styles.micText}>
                      {listening ? "● Grabando… (toca para parar)" : "🎤 Dictar"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={prompt}
                onChangeText={setPrompt}
                multiline
                placeholder="¿Qué quieres que haga el agente?"
                placeholderTextColor={palette.muted}
              />
            </>
          )}

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={() => void launch()}
              disabled={!canLaunch}
              style={[styles.launchBtn, !canLaunch && styles.disabled]}
            >
              <Text style={styles.launchText}>Lanzar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: {
      backgroundColor: p.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 20,
      gap: 8,
    },
    title: { fontSize: 20, fontWeight: "700", marginBottom: 4, color: p.text },
    muted: { color: p.muted, paddingVertical: 12 },
    warn: { color: "#b45309", fontSize: 12, marginTop: 8 },
    label: { fontSize: 12, color: p.muted, marginTop: 8 },
    labelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 8,
    },
    mic: { paddingVertical: 4, paddingHorizontal: 6 },
    micText: { fontSize: 12, color: p.primary, fontWeight: "600" },
    micOn: { fontSize: 12, color: "#dc2626", fontWeight: "700" },
    chips: { flexDirection: "row", gap: 8 },
    chip: {
      borderWidth: 1,
      borderColor: p.inputBorder,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipOn: { backgroundColor: p.primary, borderColor: p.primary },
    chipText: { color: p.badgeText },
    chipOnText: { color: p.primaryText, fontWeight: "600" },
    input: {
      borderWidth: 1,
      borderColor: p.inputBorder,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: p.text,
    },
    multiline: { minHeight: 80, textAlignVertical: "top" },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
    cancelBtn: { paddingHorizontal: 16, paddingVertical: 12 },
    cancelText: { color: p.muted, fontWeight: "600" },
    launchBtn: {
      backgroundColor: p.primary,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 8,
    },
    launchText: { color: p.primaryText, fontWeight: "700" },
    disabled: { opacity: 0.5 },
  });
