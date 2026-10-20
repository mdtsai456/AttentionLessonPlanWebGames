"""同帳號雙分頁玩同一款遊戲的鎖定。見 docs/adr/0006-game-lock.md。"""

from __future__ import annotations


def test_acquire_succeeds_when_nobody_holds_the_lock(client, db, login_as_student):
    _, headers = login_as_student()

    response = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    )

    assert response.status_code == 200
    assert len(response.json()["lockId"]) > 10


def test_second_tab_acquiring_the_same_game_is_rejected(client, db, login_as_student):
    _, headers = login_as_student()
    first = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    )
    assert first.status_code == 200

    second = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    )

    assert second.status_code == 409
    assert second.json() == {"detail": "此遊戲已在另一個分頁進行中"}


def test_different_game_is_not_blocked_by_an_existing_lock(client, db, login_as_student):
    _, headers = login_as_student()
    client.post("/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers)

    other_game = client.post(
        "/api/game-lock/acquire", json={"gameId": "DAT"}, headers=headers
    )

    assert other_game.status_code == 200


def test_heartbeat_keeps_the_lock_for_its_holder(client, db, login_as_student):
    _, headers = login_as_student()
    lock_id = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    ).json()["lockId"]

    response = client.post(
        "/api/game-lock/heartbeat",
        json={"gameId": "DCCS", "lockId": lock_id},
        headers=headers,
    )

    assert response.status_code == 204


def test_heartbeat_with_a_stale_lock_id_is_rejected(client, db, login_as_student):
    """鎖已經被別人（或同一人之後重新 acquire）取走後，原本那次的心跳要被拒絕。"""
    _, headers = login_as_student()
    client.post("/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers)

    response = client.post(
        "/api/game-lock/heartbeat",
        json={"gameId": "DCCS", "lockId": "not-the-current-holder"},
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "已在另一個分頁繼續這款遊戲"}


def test_release_then_another_tab_can_acquire(client, db, login_as_student):
    _, headers = login_as_student()
    lock_id = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    ).json()["lockId"]

    released = client.post(
        "/api/game-lock/release",
        json={"gameId": "DCCS", "lockId": lock_id},
        headers=headers,
    )
    assert released.status_code == 204

    second = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    )
    assert second.status_code == 200


def test_release_with_wrong_lock_id_is_a_no_op(client, db, login_as_student):
    """release 帶錯的 lockId（例如慢到的舊請求）不能把別人剛拿到的鎖也刪掉。"""
    _, headers = login_as_student()
    first_lock_id = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    ).json()["lockId"]

    stale_release = client.post(
        "/api/game-lock/release",
        json={"gameId": "DCCS", "lockId": "some-other-lock-id"},
        headers=headers,
    )
    assert stale_release.status_code == 204

    heartbeat = client.post(
        "/api/game-lock/heartbeat",
        json={"gameId": "DCCS", "lockId": first_lock_id},
        headers=headers,
    )
    assert heartbeat.status_code == 204


def test_acquire_succeeds_after_previous_holder_heartbeat_times_out(
    client, db, login_as_student
):
    """分頁關閉或當掉、心跳逾時沒更新時，鎖可以換人，不會永久卡住。"""
    _, headers = login_as_student()
    first_lock_id = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    ).json()["lockId"]
    db.execute(
        "UPDATE game_lock SET heartbeat_at = '2000-01-01 00:00:00' WHERE lock_id = %s",
        [first_lock_id],
    )

    second = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    )

    assert second.status_code == 200
    assert second.json()["lockId"] != first_lock_id
    # 原本的持有者之後送心跳，應該已經被換掉。
    old_heartbeat = client.post(
        "/api/game-lock/heartbeat",
        json={"gameId": "DCCS", "lockId": first_lock_id},
        headers=headers,
    )
    assert old_heartbeat.status_code == 409


def test_unsupported_game_id_is_rejected(client, db, login_as_student):
    _, headers = login_as_student()

    response = client.post(
        "/api/game-lock/acquire", json={"gameId": "NotAGame"}, headers=headers
    )

    assert response.status_code == 400


def test_teacher_token_cannot_acquire_a_game_lock(client, db, login_as_teacher):
    _, headers = login_as_teacher()

    response = client.post(
        "/api/game-lock/acquire", json={"gameId": "DCCS"}, headers=headers
    )

    assert response.status_code == 403


def test_acquire_requires_authentication(client, db):
    response = client.post("/api/game-lock/acquire", json={"gameId": "DCCS"})

    assert response.status_code == 401
