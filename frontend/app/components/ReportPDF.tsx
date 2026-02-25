'use client';

import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  Svg,
  Circle,
  Path,
  StyleSheet,
} from '@react-pdf/renderer';
import { SessionAnalytics } from '../hooks/useSessionAnalytics';
import { AIFeedbackResponse } from '../services/api';
import { PersonaBestPractices } from '../config/config';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BestPracticeChecks {
  wpm: { label: string; range: string; check: (v: number) => boolean };
  eyeContact: { label: string; range: string; check: (v: number) => boolean };
  fillers: { label: string; range: string; check: (v: number) => boolean };
  pauses: { label: string; range: string; check: (v: number) => boolean };
}

export interface ReportDocumentProps {
  sessionData: SessionAnalytics;
  aiFeedback: AIFeedbackResponse | null;
  stats: {
    avgWpm: number;
    avgVolume: number;
    avgEyeContact: number;
    totalFillers: number;
    totalPauses: number;
  } | null;
  overallScore: number;
  feedbackPersonaLabel: string;
  bp: PersonaBestPractices;
  BEST_PRACTICES: BestPracticeChecks;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildArcPath(score: number): string {
  const [cx, cy, r] = [64, 64, 54];
  const pct = Math.min(score / 100, 0.9999);
  const start = polarToCartesian(cx, cy, r, 0);
  const end = polarToCartesian(cx, cy, r, pct * 360);
  const large = pct * 360 > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function scoreColor(score: number): string {
  return score >= 80 ? '#16a34a' : score >= 60 ? '#ca8a04' : '#dc2626';
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const MAROON = '#800001';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#111827',
    paddingTop: 32,
    paddingBottom: 40,
    paddingHorizontal: 32,
    backgroundColor: '#ffffff',
  },
  // Header
  header: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 3,
  },
  headerPersona: {
    color: MAROON,
    fontFamily: 'Helvetica-Bold',
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    marginVertical: 12,
  },
  // Card
  card: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#FAFAFA',
  },
  cardTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 10,
  },
  // Score ring row
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  summaryText: {
    flex: 1,
  },
  scoreLabel: {
    fontSize: 8,
    color: '#6B7280',
    marginTop: 2,
    textAlign: 'center',
  },
  scoreNumber: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginTop: -58,
  },
  // Badges
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 8,
  },
  badgeGreen: {
    backgroundColor: '#DCFCE7',
    color: '#166534',
  },
  badgeYellow: {
    backgroundColor: '#FEF9C3',
    color: '#713F12',
  },
  // Two-column layout
  twoCol: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  col: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 14,
    backgroundColor: '#FAFAFA',
  },
  // Metric row
  metricRow: {
    marginBottom: 10,
  },
  metricLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    marginBottom: 2,
  },
  metricValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  metricValue: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
  },
  barTrack: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
  metricNote: {
    fontSize: 7,
    color: '#9CA3AF',
    marginTop: 2,
  },
  // Recommendations
  recRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  recBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: MAROON,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  recBadgeText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
  },
  recTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  recDesc: {
    fontSize: 8,
    color: '#6B7280',
    marginTop: 1,
    lineHeight: 1.4,
  },
  // Content strengths
  strengthRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 5,
  },
  strengthCheck: {
    fontSize: 9,
    color: '#16a34a',
    flexShrink: 0,
    marginTop: 1,
  },
  strengthText: {
    fontSize: 9,
    color: '#374151',
    lineHeight: 1.4,
    flex: 1,
  },
  // Timestamped feedback
  feedbackRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 5,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    alignItems: 'flex-start',
  },
  feedbackTimestamp: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexShrink: 0,
    minWidth: 60,
    textAlign: 'center',
  },
  feedbackMsg: {
    fontSize: 8,
    color: '#374151',
    lineHeight: 1.4,
    flex: 1,
  },
  // Best practices table
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  tableHeaderCell: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  tableCell: {
    fontSize: 8,
    color: '#111827',
  },
  tableCellBold: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  statusPass: {
    fontSize: 8,
    color: '#16a34a',
    fontFamily: 'Helvetica-Bold',
  },
  statusFail: {
    fontSize: 8,
    color: '#ca8a04',
    fontFamily: 'Helvetica-Bold',
  },
  col1: { flex: 2 },
  col2: { flex: 1.5 },
  col3: { flex: 1.5 },
  col4: { flex: 1, textAlign: 'center' },
  // Window table — more columns
  wCol1: { flex: 0.7 },
  wCol2: { flex: 1.5 },
  wCol3: { flex: 1 },
  wCol4: { flex: 1 },
  wCol5: { flex: 0.8 },
  wCol6: { flex: 0.8 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 8,
  },
  sectionContainer: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    backgroundColor: '#FAFAFA',
    overflow: 'hidden',
  },
  sectionHeader: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  sectionHeaderTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  sectionBody: {
    padding: 14,
  },
});

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreRingSvg({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <View style={{ alignItems: 'center', width: 90 }}>
      <Svg viewBox="0 0 128 128" width={90} height={90}>
        <Circle cx="64" cy="64" r="54" fill="none" stroke="#E5E7EB" strokeWidth="8" />
        <Path
          d={buildArcPath(score)}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
        />
      </Svg>
      {/* Score number overlay — positioned relative to SVG */}
      <Text style={{ fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#111827', marginTop: -58, textAlign: 'center' }}>
        {score}
      </Text>
      <Text style={{ fontSize: 7, color: '#6B7280', marginTop: 38, textAlign: 'center' }}>
        Overall Score
      </Text>
    </View>
  );
}

function MetricBarRow({
  label,
  value,
  displayValue,
  max,
  color,
  note,
}: {
  label: string;
  value: number;
  displayValue: string;
  max: number;
  color: string;
  note?: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <View style={styles.metricRow}>
      <View style={styles.metricValueRow}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, { color }]}>{displayValue}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      {note && <Text style={styles.metricNote}>{note}</Text>}
    </View>
  );
}

// ─── Main Document ────────────────────────────────────────────────────────────

export function ReportDocument({
  sessionData,
  aiFeedback,
  stats,
  overallScore,
  feedbackPersonaLabel,
  bp,
  BEST_PRACTICES,
}: ReportDocumentProps) {
  const { windows } = sessionData;

  const wpmColor = stats
    ? BEST_PRACTICES.wpm.check(stats.avgWpm)
      ? '#16a34a'
      : stats.avgWpm >= bp.wpm.min - (bp.wpm.max - bp.wpm.min) && stats.avgWpm <= bp.wpm.max + (bp.wpm.max - bp.wpm.min)
        ? '#ca8a04'
        : '#dc2626'
    : '#6B7280';

  const eyeColor = stats
    ? stats.avgEyeContact >= bp.eyeContact.min
      ? '#16a34a'
      : stats.avgEyeContact >= bp.eyeContact.min - 20
        ? '#ca8a04'
        : '#dc2626'
    : '#6B7280';

  const volColor = stats
    ? stats.avgVolume >= 40 && stats.avgVolume <= 80
      ? '#16a34a'
      : stats.avgVolume >= 20
        ? '#ca8a04'
        : '#dc2626'
    : '#6B7280';

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Presentation Analysis Report</Text>
          {feedbackPersonaLabel ? (
            <Text style={styles.headerSubtitle}>
              Feedback tailored for:{' '}
              <Text style={styles.headerPersona}>{feedbackPersonaLabel}</Text>
            </Text>
          ) : (
            <Text style={styles.headerSubtitle}>
              {sessionData.personaTitle} · {windows.length} windows recorded
            </Text>
          )}
          <Text style={[styles.headerSubtitle, { marginTop: 1 }]}>
            Session: {sessionData.sessionId}
          </Text>
        </View>

        <View style={styles.divider} />

        {/* ── Performance Summary ────────────────────────────────────────── */}
        {stats && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Performance Summary</Text>
            <View style={styles.summaryRow}>
              <ScoreRingSvg score={overallScore} />
              <View style={styles.summaryText}>
                {aiFeedback ? (
                  <Text style={{ fontSize: 9, color: '#374151', lineHeight: 1.5 }}>
                    {aiFeedback.performanceSummary.overallAssessment}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 9, color: '#374151', lineHeight: 1.5 }}>
                    Session completed with {windows.length} analysis window{windows.length !== 1 ? 's' : ''}.
                    Review your detailed metrics below.
                  </Text>
                )}
                {/* Badges */}
                <View style={styles.badgeRow}>
                  {BEST_PRACTICES.wpm.check(stats.avgWpm) && (
                    <Text style={[styles.badge, styles.badgeGreen]}>Good pacing</Text>
                  )}
                  {!BEST_PRACTICES.eyeContact.check(stats.avgEyeContact) && (
                    <Text style={[styles.badge, styles.badgeYellow]}>Improve eye contact</Text>
                  )}
                  {BEST_PRACTICES.fillers.check(stats.totalFillers) && (
                    <Text style={[styles.badge, styles.badgeGreen]}>Minimal fillers</Text>
                  )}
                  {BEST_PRACTICES.pauses.check(stats.totalPauses) && (
                    <Text style={[styles.badge, styles.badgeGreen]}>Good use of pauses</Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Two-column: Metrics + Recommendations ─────────────────────── */}
        {stats && (
          <View style={styles.twoCol}>
            {/* Detailed Metrics */}
            <View style={styles.col}>
              <Text style={styles.cardTitle}>Detailed Metrics</Text>
              <MetricBarRow
                label="Speaking Pace"
                value={stats.avgWpm}
                displayValue={`${stats.avgWpm} wpm`}
                max={200}
                color={wpmColor}
                note={aiFeedback?.performanceSummary.deliveryFeedback.speakingPace}
              />
              <MetricBarRow
                label="Eye Contact"
                value={stats.avgEyeContact}
                displayValue={`${stats.avgEyeContact}%`}
                max={100}
                color={eyeColor}
                note={aiFeedback?.performanceSummary.deliveryFeedback.eyeContact}
              />
              <MetricBarRow
                label="Volume"
                value={stats.avgVolume}
                displayValue={`${stats.avgVolume}%`}
                max={100}
                color={volColor}
                note={aiFeedback?.performanceSummary.deliveryFeedback.volume}
              />
              {/* Filler words — no bar, just count */}
              <View style={styles.metricRow}>
                <View style={styles.metricValueRow}>
                  <Text style={styles.metricLabel}>Filler Words</Text>
                  <Text style={[styles.metricValue, {
                    color: stats.totalFillers <= bp.fillerWords.max ? '#16a34a'
                      : stats.totalFillers <= bp.fillerWords.max * 2 ? '#ca8a04' : '#dc2626',
                  }]}>
                    {stats.totalFillers} detected
                  </Text>
                </View>
                {aiFeedback && (
                  <Text style={styles.metricNote}>
                    {aiFeedback.performanceSummary.deliveryFeedback.fillerWords}
                  </Text>
                )}
              </View>
              {/* Strategic pauses — no bar */}
              <View style={styles.metricRow}>
                <View style={styles.metricValueRow}>
                  <Text style={styles.metricLabel}>Strategic Pauses</Text>
                  <Text style={[styles.metricValue, { color: '#111827' }]}>
                    {stats.totalPauses}
                  </Text>
                </View>
                {aiFeedback && (
                  <Text style={styles.metricNote}>
                    {aiFeedback.performanceSummary.deliveryFeedback.pauses}
                  </Text>
                )}
              </View>
            </View>

            {/* Key Recommendations */}
            {aiFeedback && aiFeedback.keyRecommendations.length > 0 && (
              <View style={styles.col}>
                <Text style={styles.cardTitle}>
                  Key Recommendations{feedbackPersonaLabel ? ` for ${feedbackPersonaLabel}` : ''}
                </Text>
                {aiFeedback.keyRecommendations.map((rec, i) => (
                  <View key={i} style={styles.recRow}>
                    <View style={styles.recBadge}>
                      <Text style={styles.recBadgeText}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recTitle}>{rec.title}</Text>
                      <Text style={styles.recDesc}>{rec.description}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── Content Strengths ──────────────────────────────────────────── */}
        {aiFeedback && aiFeedback.performanceSummary.contentStrengths.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderTitle}>Content Strengths</Text>
            </View>
            <View style={styles.sectionBody}>
              {aiFeedback.performanceSummary.contentStrengths.map((strength, i) => (
                <View key={i} style={styles.strengthRow}>
                  <Text style={styles.strengthCheck}>✓</Text>
                  <Text style={styles.strengthText}>{strength}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Timestamped Feedback ───────────────────────────────────────── */}
        {aiFeedback && aiFeedback.timestampedFeedback && aiFeedback.timestampedFeedback.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderTitle}>Timestamped Feedback</Text>
            </View>
            <View style={styles.sectionBody}>
              {aiFeedback.timestampedFeedback.map((event, i) => (
                <View key={i} style={styles.feedbackRow}>
                  <Text style={styles.feedbackTimestamp}>{event.timestamp}</Text>
                  <Text style={styles.feedbackMsg}>{event.message}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Best Practices Comparison ──────────────────────────────────── */}
        {stats && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderTitle}>Comparison with Best Practices</Text>
            </View>
            {/* Table header */}
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, styles.col1]}>Metric</Text>
              <Text style={[styles.tableHeaderCell, styles.col2]}>Your Performance</Text>
              <Text style={[styles.tableHeaderCell, styles.col3]}>Best Practice</Text>
              <Text style={[styles.tableHeaderCell, styles.col4]}>Status</Text>
            </View>
            {[
              { key: 'wpm' as const, value: stats.avgWpm, display: `${stats.avgWpm} wpm` },
              { key: 'eyeContact' as const, value: stats.avgEyeContact, display: `${stats.avgEyeContact}%` },
              { key: 'fillers' as const, value: stats.totalFillers, display: `${stats.totalFillers}` },
              { key: 'pauses' as const, value: stats.totalPauses, display: `${stats.totalPauses}` },
            ].map((row) => {
              const bpCheck = BEST_PRACTICES[row.key];
              const passing = bpCheck.check(row.value);
              return (
                <View key={row.key} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.col1]}>{bpCheck.label}</Text>
                  <Text style={[styles.tableCellBold, styles.col2]}>{row.display}</Text>
                  <Text style={[styles.tableCell, styles.col3]}>{bpCheck.range}</Text>
                  <Text style={[passing ? styles.statusPass : styles.statusFail, styles.col4]}>
                    {passing ? '✓ Pass' : '⚠ Review'}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── 30-Second Window Analysis ──────────────────────────────────── */}
        {windows.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderTitle}>30-Second Window Analysis</Text>
            </View>
            {/* Table header */}
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, styles.wCol1]}>#</Text>
              <Text style={[styles.tableHeaderCell, styles.wCol2]}>Speaking Pace</Text>
              <Text style={[styles.tableHeaderCell, styles.wCol3]}>Volume</Text>
              <Text style={[styles.tableHeaderCell, styles.wCol4]}>Eye Contact</Text>
              <Text style={[styles.tableHeaderCell, styles.wCol5]}>Fillers</Text>
              <Text style={[styles.tableHeaderCell, styles.wCol6]}>Pauses</Text>
            </View>
            {windows.map((w) => (
              <View key={w.windowNumber} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.wCol1]}>#{w.windowNumber}</Text>
                <Text style={[styles.tableCell, styles.wCol2]}>
                  {w.speakingPace.average} wpm (sd:{w.speakingPace.standardDeviation})
                </Text>
                <Text style={[styles.tableCell, styles.wCol3]}>{w.volumeLevel.average}%</Text>
                <Text style={[styles.tableCell, styles.wCol4]}>{w.eyeContactScore}%</Text>
                <Text style={[styles.tableCell, styles.wCol5]}>{w.fillerWords}</Text>
                <Text style={[styles.tableCell, styles.wCol6]}>{w.pauses}</Text>
              </View>
            ))}
          </View>
        )}

      </Page>
    </Document>
  );
}
