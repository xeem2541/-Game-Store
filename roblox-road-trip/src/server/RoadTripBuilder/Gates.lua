-- โมดูล Gates (ส่วนหนึ่งของ RoadTripBuilder) : ModuleScript ชื่อ Gates
return function(S)
local Players, zoneIndexAt, frame, baseY, part, ZONE_LENGTH, ROAD_WIDTH, CHECKPOINT_EVERY, BOOST_EVERY, BOOST_TIME, ZONES, TOTAL, roadF, gatesF, boostF, padsF, startFrame = S.Players, S.zoneIndexAt, S.frame, S.baseY, S.part, S.ZONE_LENGTH, S.ROAD_WIDTH, S.CHECKPOINT_EVERY, S.BOOST_EVERY, S.BOOST_TIME, S.ZONES, S.TOTAL, S.roadF, S.gatesF, S.boostF, S.padsF, S.startFrame

local checkpoints = {} -- [i] = { cf = CFrame ที่เกิด, zone = index โซน }
checkpoints[0] = { cf = frame(20) * CFrame.new(0, 3.2, 0), zone = 1 }

local playerState = {} -- [player] = { progress = n }
local cars = {} -- [player] = car record

local function playerFromPart(hit)
	local model = hit:FindFirstAncestorOfClass("Model")
	if not model then
		return nil
	end
	local uid = model:GetAttribute("OwnerUserId")
	if uid then
		return Players:GetPlayerByUserId(uid)
	end
	return Players:GetPlayerFromCharacter(model)
end

local function setProgress(player, idx)
	local st = playerState[player]
	if not st then
		return
	end
	st.progress = idx
	local cp = checkpoints[idx]
	local zone = ZONES[cp.zone]
	player:SetAttribute("Zone", zone.name)
	player:SetAttribute("ZoneThai", zone.thai)
	player:SetAttribute("Checkpoint", idx)
	local ls = player:FindFirstChild("leaderstats")
	if ls and ls:FindFirstChild("Checkpoint") then
		ls.Checkpoint.Value = idx
	end
end

local function makeGateSign(parent, text, size, cf, accent)
	local sign = part(parent, size, cf, Color3.fromRGB(25, 25, 30), Enum.Material.SmoothPlastic)
	for _, face in ipairs({ Enum.NormalId.Front, Enum.NormalId.Back }) do
		local gui = Instance.new("SurfaceGui")
		gui.Face = face
		gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
		gui.PixelsPerStud = 30
		gui.Parent = sign
		local label = Instance.new("TextLabel")
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.TextScaled = true
		label.Font = Enum.Font.GothamBold
		label.Text = text
		label.TextColor3 = accent
		label.Parent = gui
	end
	return sign
end

local function buildGate(t, label, accent, onTouch)
	local base = frame(t)
	local half = ROAD_WIDTH / 2 + 2.5
	for _, s in ipairs({ -1, 1 }) do
		part(gatesF, Vector3.new(2.5, 18, 2.5), base * CFrame.new(s * half, 8, 0),
			Color3.fromRGB(235, 235, 240), Enum.Material.Metal)
	end
	part(gatesF, Vector3.new(half * 2 + 2.5, 3, 3), base * CFrame.new(0, 17.5, 0),
		Color3.fromRGB(235, 235, 240), Enum.Material.Metal)
	part(gatesF, Vector3.new(half * 2, 0.5, 0.5), base * CFrame.new(0, 15.7, 0), accent, Enum.Material.Neon)
	makeGateSign(gatesF, label, Vector3.new(half * 1.5, 6, 0.6), base * CFrame.new(0, 22, 0), accent)

	local trigger = part(gatesF, Vector3.new(ROAD_WIDTH + 6, 26, 4), base * CFrame.new(0, 13, 0),
		accent, Enum.Material.SmoothPlastic)
	trigger.Transparency = 1
	trigger.CanCollide = false
	trigger.Name = "Trigger"
	trigger.Touched:Connect(function(hit)
		local player = playerFromPart(hit)
		if player then
			onTouch(player)
		end
	end)
end

----------------------------------------------------------------------
-- จุดเสกรถ
----------------------------------------------------------------------

local function buildSpawnPad(cf, labelText)
	local pad = part(padsF, Vector3.new(10, 0.5, 10), cf, Color3.fromRGB(60, 255, 120), Enum.Material.Neon)
	pad.Name = "CarSpawnPad"
	local ring = part(padsF, Vector3.new(11, 0.3, 11), cf * CFrame.new(0, -0.1, 0), Color3.fromRGB(20, 20, 25),
		Enum.Material.Metal)
	ring.CanCollide = false

	local board = Instance.new("BillboardGui")
	board.Size = UDim2.fromOffset(180, 40)
	board.StudsOffset = Vector3.new(0, 4, 0)
	board.AlwaysOnTop = false
	board.MaxDistance = 120
	board.Parent = pad
	local lbl = Instance.new("TextLabel")
	lbl.Size = UDim2.fromScale(1, 1)
	lbl.BackgroundTransparency = 1
	lbl.TextScaled = true
	lbl.Font = Enum.Font.GothamBold
	lbl.TextColor3 = Color3.fromRGB(255, 255, 255)
	lbl.TextStrokeTransparency = 0.3
	lbl.Text = labelText
	lbl.Parent = board

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "เสกรถ"
	prompt.ObjectText = "Spawn Car"
	prompt.HoldDuration = 0.25
	prompt.MaxActivationDistance = 14
	prompt.RequiresLineOfSight = false
	prompt.Parent = pad
	prompt.Triggered:Connect(function(player)
		S.spawnCar(player)
	end)
end

buildSpawnPad(startFrame * CFrame.new(10, 0.1, 50), "🚗 เสกรถที่นี่")

----------------------------------------------------------------------
-- สร้างเช็คพอยต์ + เส้นชัย
----------------------------------------------------------------------
local cpCount = 0
for t = CHECKPOINT_EVERY, TOTAL - 1, CHECKPOINT_EVERY do
	if t < TOTAL - 100 then
		cpCount = cpCount + 1
	end
end
local FINISH_INDEX = cpCount + 1

do
	local idx = 0
	for t = CHECKPOINT_EVERY, TOTAL - 100, CHECKPOINT_EVERY do
		idx = idx + 1
		local myIdx = idx
		local zi = zoneIndexAt(t + 1)
		local isZoneStart = (t % ZONE_LENGTH == 0)
		local zone = ZONES[zi]
		checkpoints[myIdx] = { cf = frame(t + 25) * CFrame.new(0, 3.2, 0), zone = zi }

		local label
		if isZoneStart then
			label = string.format("ZONE %d · %s\n%s", zi, string.upper(zone.name), zone.thai)
		else
			label = string.format("CHECKPOINT %d", myIdx)
		end

		buildGate(t, label, zone.accent, function(player)
			local st = playerState[player]
			if st and myIdx > st.progress then
				setProgress(player, myIdx)
				player:SetAttribute("Toast", string.format("✅ เช็คพอยต์ %d/%d · %s", myIdx, FINISH_INDEX, zone.thai))
			end
		end)

		-- แผ่นเสกรถข้างเช็คพอยต์
		local padCF = CFrame.new(frame(t, ROAD_WIDTH / 2 + 12).X, baseY(t, ROAD_WIDTH / 2 + 12) + 0.25,
			frame(t, ROAD_WIDTH / 2 + 12).Z) * frame(t).Rotation
		buildSpawnPad(padCF, "🚗 เสกรถ")
	end

	-- เส้นชัย
	local tFinish = TOTAL - 20
	checkpoints[FINISH_INDEX] = { cf = frame(tFinish) * CFrame.new(0, 3.2, 0), zone = #ZONES }
	buildGate(tFinish, "🏁 FINISH", Color3.fromRGB(255, 255, 255), function(player)
		local st = playerState[player]
		if st and st.progress > 0 and st.progress < FINISH_INDEX then
			local ls = player:FindFirstChild("leaderstats")
			if ls and ls:FindFirstChild("Trips") then
				ls.Trips.Value = ls.Trips.Value + 1
			end
			player:SetAttribute("Toast", "🏁 ถึงปลายทางแล้ว! ทริปสำเร็จ — เริ่มทริปใหม่ได้เลย")
			setProgress(player, 0)
		end
	end)
	-- ลานจอดปลายทาง
	local endF = frame(TOTAL)
	part(roadF, Vector3.new(150, 1, 140), endF * CFrame.new(0, -0.7, -70), Color3.fromRGB(122, 92, 62),
		Enum.Material.Ground)
end

----------------------------------------------------------------------
-- แผ่นบูสต์
----------------------------------------------------------------------
local function applyBoost(player, padCF)
	local car = cars[player]
	if not car or not car.model.Parent then
		return
	end
	local now = os.clock()
	local current = car.model:GetAttribute("BoostUntil") or 0
	if current - now > BOOST_TIME - 0.6 then
		return -- เพิ่งโดนบูสต์ไป
	end
	car.model:SetAttribute("BoostUntil", now + BOOST_TIME)
	local look = padCF.LookVector
	local seat = car.seat
	seat.AssemblyLinearVelocity = seat.AssemblyLinearVelocity + look * 45
end

do
	local k = 0
	for t = 250, TOTAL - 300, BOOST_EVERY do
		k = k + 1
		local lane = ((k % 3) - 1) * 10
		local padCF = frame(t, lane) * CFrame.new(0, 0.15, 0)
		local pad = part(boostF, Vector3.new(12, 0.25, 16), padCF, Color3.fromRGB(10, 25, 45), Enum.Material.Metal)
		pad.Name = "BoostPad"
		pad.CanCollide = false
		for _, zoff in ipairs({ -4, 4 }) do
			for _, s in ipairs({ -1, 1 }) do
				local arm = part(boostF, Vector3.new(1, 0.1, 6.2),
					padCF * CFrame.new(s * 2.1, 0.17, zoff - 0.9) * CFrame.Angles(0, s * math.rad(45), 0),
					Color3.fromRGB(0, 230, 255), Enum.Material.Neon)
				arm.CanCollide = false
			end
		end
		pad.Touched:Connect(function(hit)
			local player = playerFromPart(hit)
			if player and cars[player] and hit:IsDescendantOf(cars[player].model) then
				applyBoost(player, padCF)
			end
		end)
	end
end

S.playerFromPart = playerFromPart
S.setProgress = setProgress
S.makeGateSign = makeGateSign
S.buildGate = buildGate
S.buildSpawnPad = buildSpawnPad
S.applyBoost = applyBoost
S.checkpoints = checkpoints
S.playerState = playerState
S.cars = cars
S.cpCount = cpCount
S.FINISH_INDEX = FINISH_INDEX
end
