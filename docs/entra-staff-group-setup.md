# Letting e-Recruitment add new staff to the staff app's group

**For:** UCAA's Microsoft Entra administrator.
**Time:** about 30 minutes, including a test.

## What this is for

When a system administrator creates a staff account in e-Recruitment, the
system adds that person to the Entra security group that gives access to the
**e-Recruitment staff** app, so they can sign in straight away. Deactivating
the account removes them; reactivating adds them back. Being in the group
gives nothing inside e-Recruitment by itself; the role set in e-Recruitment
decides that.

To do this, e-Recruitment's directory app (the one it already uses to search
the directory) needs to change the members of **that one group and no
other**. Use the setup below **instead of** the Graph permission
`GroupMember.ReadWrite.All`. That permission would let the app change the
membership of almost every group in the tenant.

How it works:
- An **administrative unit** holds only the staff group.
- A **custom role** can only update the members of security groups.
- That role is given to the app **scoped to that administrative unit**.

If the app's secret ever leaked, the most anyone could do with it is add
people to or remove people from the staff app's group.

## Before you start

- **Microsoft Entra ID P1** in the tenant. Custom roles and administrative
  unit roles need it.
- Sign in as **Privileged Role Administrator** or Global Administrator.
- **Microsoft Graph PowerShell** (`Install-Module Microsoft.Graph -Scope CurrentUser`).
- From whoever runs e-Recruitment:
  - the **directory app's client ID**: `ENTRA_DIRECTORY_CLIENT_ID` in the
    server's settings, or the staff app's client ID if that is not set;
  - for the test only, its client secret.

## 1. Check the staff group

In the Entra admin center, go to **Enterprise applications**, open the
e-Recruitment staff app, then **Users and groups**. Find the group assigned
there. It must be:
- a **security** group with **Assigned** membership (not dynamic);
- **cloud-only** (not synced from on-premises Active Directory, whose
  membership can only be changed in AD);
- **not mail-enabled** and **not role-assignable**;
- assigned to the app **directly**. Entra ignores nested groups for app access.

Also check that **Properties > Assignment required?** is **Yes** on the app.

If the current group fails any of these, create a new cloud security group,
assign it to the app, and use that group.

Copy the group's **Object ID**. It is needed in steps 2 and 7.

## 2. to 5. Create the unit and the role, and give them to the app

Run this in PowerShell, filling in the two values at the top:

```powershell
$directoryAppId = "<directory app client ID>"
$staffGroupId   = "<staff group Object ID>"

Connect-MgGraph -Scopes "RoleManagement.ReadWrite.Directory","AdministrativeUnit.ReadWrite.All","Group.Read.All","Application.Read.All"

$sp = Get-MgServicePrincipal -Filter "appId eq '$directoryAppId'"

# 2. An administrative unit holding only the staff group.
$au = New-MgDirectoryAdministrativeUnit -DisplayName "e-Recruitment staff access" `
  -Description "Only the e-Recruitment staff app's group. The e-Recruitment app manages its members."
New-MgDirectoryAdministrativeUnitMemberByRef -AdministrativeUnitId $au.Id `
  -OdataId "https://graph.microsoft.com/v1.0/groups/$staffGroupId"

# 3. A custom role that can only change the members of ordinary security groups.
$role = New-MgRoleManagementDirectoryRoleDefinition -DisplayName "e-Recruitment staff group membership" `
  -Description "Add and remove members of the e-Recruitment staff app's group (assigned at the administrative unit only)." `
  -IsEnabled:$true `
  -RolePermissions @(@{ AllowedResourceActions = @("microsoft.directory/groups.security.assignedMembership/members/update") })

# 4. That role for the app, over the administrative unit only.
New-MgRoleManagementDirectoryRoleAssignment -PrincipalId $sp.Id -RoleDefinitionId $role.Id `
  -DirectoryScopeId "/administrativeUnits/$($au.Id)"

# 5. Directory Readers for the app (read-only). Microsoft requires it before
#    an app can use a role scoped to an administrative unit.
$readers = Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq 'Directory Readers'"
New-MgRoleManagementDirectoryRoleAssignment -PrincipalId $sp.Id -RoleDefinitionId $readers.Id -DirectoryScopeId "/"
```

The same can be done in the admin center under **Roles & admins**
(Admin units, and New custom role). Assigning a role to an app is easiest in
PowerShell.

## 6. Check what the app does *not* have

Open **App registrations**, then the directory app, then **API permissions**.
Do **not** grant `GroupMember.ReadWrite.All`, `Group.ReadWrite.All` or
`Directory.ReadWrite.All`, and remove them if they are there. What it already
has stays (`User.Read.All`, `Application.Read.All`, `GroupMember.Read.All`,
all read-only).

## 7. Test it with the app's own credentials

Role assignments can take a few minutes to apply.

```powershell
Disconnect-MgGraph
$secret = ConvertTo-SecureString "<directory app client secret>" -AsPlainText -Force
$cred   = New-Object System.Management.Automation.PSCredential($directoryAppId, $secret)
Connect-MgGraph -TenantId "<tenant ID>" -ClientSecretCredential $cred

$testUserId = (Get-MgUser -UserId "<a test user's UPN>").Id

# Should work:
New-MgGroupMemberByRef -GroupId $staffGroupId -OdataId "https://graph.microsoft.com/v1.0/directoryObjects/$testUserId"
Remove-MgGroupMemberDirectoryObjectByRef -GroupId $staffGroupId -DirectoryObjectId $testUserId

# Must FAIL with "Insufficient privileges" (try a group outside the unit):
New-MgGroupMemberByRef -GroupId "<any other group's Object ID>" -OdataId "https://graph.microsoft.com/v1.0/directoryObjects/$testUserId"

Disconnect-MgGraph
```

If the first two fail, wait ten minutes and try again. If the third one
works, stop: the app has a broader permission somewhere, so recheck step 6.

## 8. Hand over to whoever runs e-Recruitment

Give them the staff group's **Object ID**. They then:
1. set `ENTRA_STAFF_GROUP_ID=<Object ID>` in the server's `backend/.env`;
2. restart the API (it keeps a Microsoft token for up to an hour, so the new
   role only applies after a restart);
3. run `node scripts/syncStaffGroup.js` to see which existing staff accounts
   are not in the group yet, then `node scripts/syncStaffGroup.js --yes` to
   add them (and take out anyone whose account is deactivated).

## Afterwards

- Every change the app makes appears in the Entra **Audit logs** (service
  "Core Directory", category "GroupManagement") under the app's name.
  e-Recruitment also records each one on the staff account.
- If a change fails, the e-Recruitment system administrators get an email and
  an in-app notice, and the account shows **Retry** on the Staff accounts
  screen.
- To stop it at any time, remove the role assignment from step 4. Accounts
  are still created, and the failures say the app's role is missing.
- People you add to the group by hand still appear on e-Recruitment's
  "Waiting for a role" list, as before.
