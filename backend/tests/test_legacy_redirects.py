import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import main

@pytest.mark.parametrize('source,target', list(main._LEGACY_REDIRECTS.items()))
def test_http_legacy_redirects(source, target):
    with TestClient(main.app) as client:
        response = client.get(source, follow_redirects=False)
        assert response.status_code == 307
        assert response.headers['location'] == target
        page = client.get(target)
        assert page.status_code == 200
        assert 'require-student.js' in page.text or '/Home/' in target

def test_missing_site_directories_still_start(tmp_path):
    application = FastAPI()
    main.mount_site_directories(application, tmp_path)
    with TestClient(application) as client:
        assert client.get("/health-not-here").status_code == 404


@pytest.mark.parametrize('path', ['Home/index.html', 'Select/index.html', 'Back/index.html', 'DAT_single/DAT_single.html', 'DAT_double/DAT_double.html', 'EFT_single/EFT_single.html', 'EFT_double/EFT_double.html', 'TGame1/index.html', 'TGame2/index.html', 'IM1/index.html', 'DCCS/index.html', 'DCCS/double.html', '主題資料.csv'])
def test_current_pages_and_shared_script_available(path):
    with TestClient(main.app) as client:
        assert client.get('/app/' + path).status_code == 200
        assert client.get('/app/shared/require-student.js').status_code == 200
