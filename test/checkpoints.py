import sys, json, urllib.request
from playwright.sync_api import sync_playwright
import os
B=os.environ.get('BASE_URL','http://localhost:3000')
fails=[]
def ok(c,m):
    print(('PASS ' if c else 'FAIL ')+m)
    if not c: fails.append(m)
def api(path, method='GET', body=None):
    r=urllib.request.Request(B+path, method=method, data=json.dumps(body).encode() if body else None, headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(r) as x: t=x.read(); return x.status, json.loads(t) if t else None
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

with sync_playwright() as p:
    br=p.chromium.launch(); pg=br.new_context(viewport={'width':1000,'height':800}).new_page()
    print('--- Stage 1: app loads with sample tasks and projects')
    pg.goto(B); pg.wait_for_selector('.row')
    ok(pg.locator('.row').count()==8, f"8 sample tasks shown ({pg.locator('.row').count()})")
    pg.goto(B+'/#projects'); pg.wait_for_selector('.proj-row'); ok(pg.locator('.proj-row').count()==3,'3 sample projects shown')

    print('--- Stage 2: create via UI, persists after reload')
    pg.goto(B); pg.wait_for_selector('.row')
    pg.fill('#quickInput','Persist me 12345'); pg.press('#quickInput','Enter'); pg.wait_for_selector('.row:has-text("Persist me 12345")')
    pg.wait_for_function("!document.querySelector('.check[disabled]')")
    pg.reload(); pg.wait_for_selector('.row')
    ok(pg.locator('.row:has-text("Persist me 12345")').count()==1,'task still there after reload')
    s,body=api('/tasks'); ok(any(t['title']=='Persist me 12345' and t['status']=='inbox' for t in body),'server has it, status inbox')

    print('--- Stage 3: every inbox item gets a status or project')
    s,before=api('/tasks?status=inbox'); n=len(before); print('   inbox items:',n)
    pg.goto(B+'/#process'); pg.wait_for_selector('.card')
    actions=['p-done','p-next','p-waiting','assign']; i=0
    while pg.locator('.card').count():
        a=actions[i%4]; i+=1
        if a=='assign':
            pg.select_option('#pProject', index=1); pg.click('[data-act="p-assign"]')
        else: pg.click(f'[data-act="{a}"]')
        pg.wait_for_function("!document.querySelector('.check[disabled]')"); pg.wait_for_timeout(250)
    ok(pg.locator('text=Inbox zero').count()==1,'UI shows Inbox zero')
    s,inbox=api('/tasks?status=inbox'); ok(inbox==[],'server: no inbox items remain')
    s,allt=api('/tasks'); ids={t['id'] for t in before}
    moved=[t for t in allt if t['id'] in ids]
    ok(len(moved)==n and all(t['status']!='inbox' for t in moved), f'all {n} processed items have a non-inbox status: '+', '.join(f"{t['status']}{'/p'+str(t['project_id']) if t['project_id'] else ''}" for t in moved))

    print('--- Stage 4: deleting a project with tasks is blocked / asks confirmation')
    s,projs=api('/projects'); busy=[x for x in projs if any(t['project_id']==x['id'] for t in allt)][0]
    s,b=api(f"/projects/{busy['id']}",'DELETE'); ok(s==409 and b.get('blocking_tasks'),f"API: DELETE project with tasks -> {s}, names {len(b.get('blocking_tasks',[]))} tasks")
    ok(api(f"/projects/{busy['id']}")[0]==200,'project still exists after blocked delete')
    pg.goto(B+'/#projects'); pg.wait_for_selector('.proj-row')
    pg.click(f'button[aria-label="Delete {busy["name"]}"]'); pg.wait_for_selector('#confirmDlg[open]')
    ok(True,'UI: confirm dialog appears'); pg.click('#confirmDlg [data-close]'); pg.wait_for_timeout(200)
    ok(api(f"/projects/{busy['id']}")[0]==200,'Cancel keeps the project')
    pg.click(f'button[aria-label="Delete {busy["name"]}"]'); pg.wait_for_selector('#confirmDlg[open]'); pg.click('#confirmOk'); pg.wait_for_timeout(400)
    ok(api(f"/projects/{busy['id']}")[0]==404,'Confirm deletes it'); s,t2=api('/tasks'); ok(len(t2)==len(allt),'its tasks were kept (unassigned), none orphaned/lost')

    print('--- Stage 5: keyboard-only (no mouse calls below)')
    def tab_to(pred, n=80):
        for _ in range(n):
            if pg.evaluate(pred): return True
            pg.keyboard.press('Tab')
        return False
    pg.goto(B); pg.wait_for_selector('.row')
    pg.keyboard.press('Tab'); pg.keyboard.press('Tab')  # leave any focus; reset
    pg.evaluate("document.activeElement.blur()")
    pg.keyboard.press('n'); ok(pg.evaluate("document.activeElement.id")=='quickInput',"n focuses quick-add")
    pg.keyboard.type('Keyboard task'); pg.keyboard.press('Enter'); pg.wait_for_selector('.row:has-text("Keyboard task")'); ok(True,'add task via keyboard')
    pg.wait_for_function("!document.querySelector('.check[disabled]')")
    ok(tab_to("(document.activeElement.getAttribute('aria-label')||'').startsWith('Complete: Keyboard task')"),'Tab reaches the new row checkbox')
    pg.keyboard.press('Space'); pg.wait_for_selector('button[aria-label="Reopen: Keyboard task"]'); ok(True,'Space completes it')
    ok(pg.evaluate("document.activeElement.getAttribute('aria-label')")=='Reopen: Keyboard task','focus stays on the control after re-render')
    ok(tab_to("document.activeElement.getAttribute('aria-label')==='Edit: Keyboard task'"),'Tab reaches Edit'); pg.keyboard.press('Enter')
    pg.wait_for_selector('#editDlg[open]'); ok(pg.evaluate("document.activeElement.id")=='eTitle','edit dialog: focus moves into dialog (title)')
    inside=True
    for _ in range(12):
        pg.keyboard.press('Tab'); inside&=pg.evaluate("!!document.activeElement.closest('#editDlg')")
    ok(inside,'edit dialog: Tab stays trapped inside')
    pg.keyboard.press('Escape'); pg.wait_for_function("!document.querySelector('#editDlg[open]')")
    ok(pg.evaluate("document.activeElement.getAttribute('aria-label')")=='Edit: Keyboard task','Esc closes and focus returns to Edit button')
    pg.keyboard.press('Enter'); pg.wait_for_selector('#editDlg[open]'); pg.keyboard.press('Control+a'); pg.keyboard.type('Keyboard task edited'); pg.keyboard.press('Enter')
    pg.wait_for_selector('.row:has-text("Keyboard task edited")'); ok(True,'edit saved with Enter')
    pg.evaluate("document.activeElement.blur()"); pg.keyboard.press('?'); pg.wait_for_selector('#helpDlg[open]'); ok(True,'? opens shortcuts'); pg.keyboard.press('Escape')
    ok(tab_to("document.activeElement.dataset.nav==='projects'"),'Tab reaches Projects nav'); pg.keyboard.press('Enter'); pg.wait_for_selector('.proj-row')
    ok(tab_to("document.activeElement.id==='projName'"),'Tab reaches project name input'); pg.keyboard.type('KB project'); pg.keyboard.press('Enter'); pg.wait_for_selector('.proj-row:has-text("KB project")'); ok(True,'create project via keyboard')
    pg.wait_for_function("!document.querySelector('[data-act=pdel][disabled]')")
    ok(tab_to("document.activeElement.getAttribute('aria-label')==='Delete KB project'"),'Tab reaches Delete'); pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    ok(pg.locator('.proj-row:has-text("KB project")').count()==0,'empty project deleted via keyboard')
    pg.goto(B+'/#projects'); pg.wait_for_selector('.proj-row'); pg.evaluate("document.activeElement.blur()")
    name=pg.locator('.proj-row a').first.inner_text()
    pg.evaluate("document.activeElement.blur()")
    ok(tab_to(f"document.activeElement.getAttribute('aria-label')==='Delete {name}'"),'Tab reaches Delete on a project with tasks'); pg.keyboard.press('Enter'); pg.wait_for_selector('#confirmDlg[open]')
    ok(pg.evaluate("!!document.activeElement.closest('#confirmDlg')"),'confirm dialog has focus inside'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    ok(pg.locator(f'.proj-row:has-text("{name}")').count()==1,'Esc cancels delete')
    br.close()
print('\nFAILED:',fails) if fails else print('\nALL CHECKPOINTS PASS')
sys.exit(1 if fails else 0)
