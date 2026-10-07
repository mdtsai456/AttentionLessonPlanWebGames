"""真實 MariaDB 授權測試：拒絕請求不得新增 assessment_result。"""
import pytest
from test_sessions import dccs_payload


def payload(grade='G1', case_id='S03', school='測試場域', mode='single'):
    body = dccs_payload()
    body['data'].update(grade=grade, caseId=case_id, school=school, mode=mode)
    return body


@pytest.mark.parametrize('reason,status', [
    ('missing',401), ('fake',401), ('expired',401), ('revoked',401),
    ('teacher',403), ('grade',403), ('caseId',403), ('school',403),
    ('partner_missing',401), ('partner_invalid',401), ('partner_expired',401),
    ('partner_revoked',401), ('partner_teacher',403),
])
def test_invalid_session_never_writes(client, db, login_as_student, login_as_teacher, reason, status):
    _, owner = login_as_student(grade='G1', case_id='S03', school='測試場域')
    _, partner = login_as_student(grade='G2', case_id='S04', school='別的場域')
    _, teacher = login_as_teacher(school='測試場域')
    body = payload(mode='double' if reason.startswith('partner_') else 'single')
    headers = {**owner, 'X-Partner-Authorization': partner['Authorization']}
    if reason == 'missing': headers.pop('Authorization')
    if reason == 'fake': headers['Authorization'] = 'Bearer fake'
    if reason == 'teacher':
        headers.update(teacher)
        body['data']['role'] = 'student'  # 偽造 payload 角色不能覆蓋 token 身分。
    if reason in ('grade', 'caseId', 'school'): body['data'][reason] = 'OTHER'
    if reason == 'partner_missing': headers.pop('X-Partner-Authorization')
    if reason == 'partner_invalid': headers['X-Partner-Authorization'] = 'Bearer fake'
    if reason == 'partner_teacher': headers['X-Partner-Authorization'] = teacher['Authorization']
    target = partner if reason.startswith('partner_') else owner
    if reason.endswith('expired'):
        db.execute("UPDATE login_session SET expires_at = '2000-01-01' WHERE token = %s", [target['Authorization'][7:]])
    if reason.endswith('revoked'):
        assert client.post('/api/auth/logout', headers=target).status_code == 204
    response = client.post('/api/sessions', json=body, headers=headers)
    assert response.status_code == status, response.text
    assert db.query('SELECT COUNT(*) AS n FROM assessment_result') == [{'n': 0}]


def test_double_each_player_is_stored_with_own_identity(client, db, login_as_student):
    _, owner = login_as_student(grade='G1', case_id='S03', school='測試場域')
    _, partner = login_as_student(grade='G2', case_id='S04', school='別的場域')
    for mine, other, body in [(owner,partner,payload(mode='double')), (partner,owner,payload('G2','S04','別的場域','double'))]:
        body['data']['pairId'] = 'pair-test'
        response = client.post('/api/sessions', json=body, headers={**mine, 'X-Partner-Authorization': other['Authorization']})
        assert response.status_code == 201, response.text
    assert db.query('SELECT grade, case_id, school, mode, pair_id FROM assessment_result ORDER BY grade') == [
        dict(grade='G1', case_id='S03', school='測試場域', mode='double', pair_id='pair-test'),
        dict(grade='G2', case_id='S04', school='別的場域', mode='double', pair_id='pair-test'),
    ]


def test_auth_me_returns_real_student_teacher_and_revocation(client, login_as_student, login_as_teacher):
    _, student = login_as_student()
    _, teacher = login_as_teacher()
    for headers, role in [(student,'student'),(teacher,'teacher')]:
        response = client.get('/api/auth/me', headers=headers)
        assert response.status_code == 200
        assert response.json()['role'] == role
        assert response.headers['cache-control'] == 'no-store'
        assert client.post('/api/auth/logout', headers=headers).status_code == 204
        rejected = client.get('/api/auth/me', headers=headers)
        assert rejected.status_code == 401
        assert rejected.headers['cache-control'] == 'no-store'
