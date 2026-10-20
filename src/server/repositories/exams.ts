/**
 * Repository for exams (migration 008). Row Level Security applies to every query.
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { daysUntil } from '@/domain/knowledge/exam';
import type { Exam, Timestamp, UUID } from '@/types';

interface ExamRow {
  id: string;
  subject: string;
  name: string;
  exam_date: string;
  created_at: string;
}

const mapExam = (row: ExamRow, now = new Date()): Exam => ({
  id: row.id as UUID,
  subject: row.subject,
  name: row.name,
  examDate: row.exam_date,
  createdAt: row.created_at as Timestamp,
  daysLeft: daysUntil(row.exam_date, now),
});

async function client() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  return { supabase, userId: user.id as UUID };
}

export async function listExams(): Promise<Exam[]> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase.from('exams').select().eq('user_id', userId).order('exam_date', { ascending: true });
  if (error) throw new Error(`Failed to list exams: ${error.message}`);
  return (data ?? []).map(r => mapExam(r));
}

export async function getExam(id: UUID): Promise<Exam | null> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase.from('exams').select().eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Failed to get exam: ${error.message}`);
  return data ? mapExam(data) : null;
}

export async function insertExam(input: { subject: string; name: string; examDate: string }): Promise<Exam> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase
    .from('exams')
    .insert({ user_id: userId, subject: input.subject, name: input.name, exam_date: input.examDate })
    .select()
    .single();
  if (error) throw new Error(`Failed to create exam: ${error.message}`);
  return mapExam(data);
}

export async function deleteExam(id: UUID): Promise<void> {
  const { supabase, userId } = await client();
  const { error } = await supabase.from('exams').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(`Failed to delete exam: ${error.message}`);
}
