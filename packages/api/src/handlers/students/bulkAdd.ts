import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, studentQueries } from '@bali/db';
import { csvImportSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

function parseCsv(csv: string): Array<{ firstName: string; lastName: string; email: string }> {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const firstNameIdx = header.findIndex(h => h === 'first_name' || h === 'firstname' || h === 'first name');
  const lastNameIdx = header.findIndex(h => h === 'last_name' || h === 'lastname' || h === 'last name');
  const nameIdx = header.findIndex(h => h === 'name');
  const emailIdx = header.findIndex(h => h === 'email');

  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim());
    let firstName = '';
    let lastName = '';

    if (firstNameIdx >= 0 && lastNameIdx >= 0) {
      firstName = cols[firstNameIdx] || '';
      lastName = cols[lastNameIdx] || '';
    } else if (nameIdx >= 0) {
      const parts = (cols[nameIdx] || '').split(' ');
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    return {
      firstName,
      lastName,
      email: emailIdx >= 0 ? cols[emailIdx] || '' : '',
    };
  });
}

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, csvImportSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  const rows = parseCsv(parsed.data!.csv);
  let imported = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.firstName || !row.lastName) {
      errors.push({ row: i + 2, message: 'Missing first or last name' });
      continue;
    }

    try {
      let student = row.email
        ? await studentQueries.findBySchoolAndEmail(teacher.schoolId, row.email)
        : null;

      if (!student) {
        student = await studentQueries.create(
          teacher.schoolId, row.firstName, row.lastName, row.email || undefined
        );
      }

      await studentQueries.addToClass(cls.id, student.id);
      imported++;
    } catch (err: any) {
      errors.push({ row: i + 2, message: err.message || 'Unknown error' });
    }
  }

  return json({ imported, errors });
}
