"""登入保護回歸：拒絕請求不得進入寫入層。"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import main
import queries
import writes
from test_sessions import dccs_payload


@pytest.fixture
def authorized_api(monkeypatch):
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    rows = {
        'owner': dict(subject_type='student', grade='G1', case_id='S03', school='測試場域', expires_at=future),
        'partner': dict(subject_type='student', grade='G2', case_id='S04', school='其他場域', expires_at=future),
        'teacher': dict(subject_type='teacher', teacher_id=1, expires_at=future),
        'expired': dict(subject_type='student', grade='G1', case_id='S03', school='測試場域', expires_at=future - timedelta(hours=2)),
    }
    monkeypatch.setattr(queries, 'fetch_login_session', rows.get)
    monkeypatch.setattr(queries, 'fetch_teacher', lambda _: dict(teacher_id=1, name='老師', school='測試場域'))
    calls = []
    monkeypatch.setattr(writes, 'insert_session_with_stats', lambda **kw: calls.append(kw) or 'saved')
    with TestClient(main.app) as client:
        yield client, calls, rows


@pytest.mark.parametrize('token,status', [(None,401), ('fake',401), ('expired',401), ('teacher',403)])
def test_reject_unauthorized_writer(authorized_api, token, status):
    client, calls, _ = authorized_api
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    response = client.post('/api/sessions', json=dccs_payload(), headers=headers)
    assert response.status_code == status
    assert calls == []


@pytest.mark.parametrize('field,value', [('grade','G2'), ('caseId','S04'), ('school','其他場域')])
def test_reject_other_student_result(authorized_api, field, value):
    client, calls, _ = authorized_api
    payload = dccs_payload()
    payload['data'][field] = value
    assert client.post('/api/sessions', json=payload, headers={'Authorization':'Bearer owner'}).status_code == 403
    assert calls == []


@pytest.mark.parametrize('partner,status', [(None,401), ('fake',401), ('expired',401), ('teacher',403), ('partner',201), ('owner',201)])
def test_double_requires_valid_student_partner(authorized_api, partner, status):
    client, calls, _ = authorized_api
    payload = dccs_payload()
    payload['data']['mode'] = 'double'
    headers = {'Authorization':'Bearer owner'}
    if partner:
        headers['X-Partner-Authorization'] = f'Bearer {partner}'
    assert client.post('/api/sessions', json=payload, headers=headers).status_code == status
    assert len(calls) == (1 if status == 201 else 0)


def test_auth_me_is_server_identity_and_uncached(authorized_api):
    client, _, _ = authorized_api
    response = client.get('/api/auth/me', headers={'Authorization':'Bearer owner'})
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert response.json()['role'] == 'student'
    assert response.json()['studentKey'] == 'G1_S03'
    assert response.json()['school'] == '測試場域'
    assert 'expiresAt' in response.json()
